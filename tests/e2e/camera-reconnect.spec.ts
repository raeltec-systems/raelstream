import { expect, test } from '@playwright/test';
import { e2eUser, endService, signIn } from './auth.js';

/**
 * A10/A11 (SPEC §8.6): the phone's link drops while its camera is on programme. The studio holds, then
 * cuts to the slate; the phone reconnects by itself into the same slot; the camera does NOT go back on
 * programme until the operator takes "Camera ready: Cut back".
 */
test('camera drop → slate → phone reconnects → operator cuts back', async ({ browser }) => {
  const studioCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const studio = await studioCtx.newPage();
  const camCtx = await browser.newContext({
    permissions: ['camera'],
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const cam = await camCtx.newPage();
  try {
    await studio.goto('/studio');
    await signIn(studio, e2eUser('reconnect'));
    await studio.getByRole('button', { name: 'Start without a saved service' }).click();
    await studio.getByRole('button', { name: 'Show pairing code' }).click();
    const url = await studio.getByTestId('pair-qr').getAttribute('data-url');
    await cam.goto(url!);
    await cam.getByRole('button', { name: 'Join as camera' }).click();
    await expect(studio.getByTestId('studio-phrase')).toBeVisible();
    await studio.getByRole('button', { name: 'Let this phone in' }).click();
    await cam.getByRole('button', { name: 'Start camera' }).click();
    await expect(studio.getByText('Connected directly')).toBeVisible({ timeout: 20_000 });
    // CAM-01: requested and actual quality are both shown on the phone
    await expect(cam.getByTestId('cam-quality')).toContainText(
      /Requested 1920×1080 · 30 fps\. Actual \d+×\d+/,
    );

    await studio.getByRole('button', { name: /^5\s*Audio$/ }).click();
    const select = studio.getByLabel('Audio input');
    const input = select.locator('option:not([value=""]):not([value="rs:phone"])').first();
    await select.selectOption((await input.getAttribute('value'))!);
    await expect(studio.getByText(/Sound detected|No sound yet/)).toBeVisible();
    await studio.getByRole('button', { name: 'Open the Studio' }).click();
    await studio.getByRole('button', { name: /Camera only/ }).click();
    await expect(studio.getByRole('button', { name: /Camera only/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The link drops for 6 s: longer than the 2 s stall + 1 s hold.
    await cam.evaluate(() =>
      (window as unknown as { rsCamTest: { dropLink: (ms: number) => void } }).rsCamTest.dropLink(
        6000,
      ),
    );
    await expect(studio.getByRole('button', { name: /Be right back slate/ })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 10_000 },
    );

    // The phone comes back by itself, without a tap, into the same slot.
    const cutBack = studio.getByRole('button', { name: 'Camera ready: Cut back' });
    await expect(cutBack).toBeVisible({ timeout: 25_000 });
    await expect(cam.getByTestId('cam-tally')).toHaveText(/ready/i);
    // ...and stays off programme until the operator decides.
    await studio.waitForTimeout(2000);
    await expect(studio.getByRole('button', { name: /Be right back slate/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await cutBack.click();
    await expect(studio.getByRole('button', { name: /Camera only/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(cutBack).toHaveCount(0);
    await expect(cam.getByTestId('cam-tally')).toHaveText(/live/i);
  } finally {
    await endService(studio).catch(() => undefined);
    await camCtx.close();
    await studioCtx.close();
  }
});

/**
 * A volunteer presses Back, closes the camera page, or the browser loses its storage, in the middle of
 * the service. Nobody should have to remove the camera and pair from scratch.
 */
test('phone page closed mid-service resumes by itself; a phone that lost it rescans the reconnect code', async ({
  browser,
}) => {
  const studioCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const studio = await studioCtx.newPage();
  const camCtx = await browser.newContext({
    permissions: ['camera'],
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  let cam = await camCtx.newPage();
  const onProgramme = () =>
    expect(studio.getByRole('button', { name: /Camera only/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  const cutBack = studio.getByRole('button', { name: 'Camera ready: Cut back' });
  try {
    await studio.goto('/studio');
    await signIn(studio, e2eUser('resume'));
    await studio.getByRole('button', { name: 'Start without a saved service' }).click();
    await studio.getByRole('button', { name: 'Show pairing code' }).click();
    const url = await studio.getByTestId('pair-qr').getAttribute('data-url');
    await cam.goto(url!);
    await cam.getByRole('button', { name: 'Join as camera' }).click();
    await studio.getByRole('button', { name: 'Let this phone in' }).click();
    await cam.getByRole('button', { name: 'Start camera' }).click();
    await expect(studio.getByText('Connected directly')).toBeVisible({ timeout: 20_000 });
    await studio.getByRole('button', { name: /^5\s*Audio$/ }).click();
    const select = studio.getByLabel('Audio input');
    const input = select.locator('option:not([value=""]):not([value="rs:phone"])').first();
    await select.selectOption((await input.getAttribute('value'))!);
    await studio.getByRole('button', { name: 'Open the Studio' }).click();
    await studio.getByRole('button', { name: /Camera only/ }).click();
    await onProgramme();

    // Back on the phone asks first; the camera keeps going.
    await cam.goBack();
    await expect(cam.getByRole('button', { name: 'Keep filming' })).toBeVisible();
    await cam.getByRole('button', { name: 'Keep filming' }).click();
    await expect(cam.getByTestId('cam-tally')).toHaveText(/live/i);

    // The page is closed and opened again (from the browser's tabs or history): no tap, no code.
    await cam.close();
    await expect(studio.getByRole('button', { name: /Be right back slate/ })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 10_000 },
    );
    await expect(studio.getByTestId('reconnect-panel')).toBeVisible();
    cam = await camCtx.newPage();
    await cam.goto('/cam');
    await expect(cutBack).toBeVisible({ timeout: 25_000 });
    await expect(studio.getByTestId('reconnect-panel')).toHaveCount(0);
    await cutBack.click();
    await onProgramme();
    await expect(cam.getByTestId('cam-tally')).toHaveText(/live/i);

    // Worse: the browser lost its saved camera link. The same phone scans the reconnect code on the
    // studio screen, taps Join, and is straight back in, without "Let this phone in".
    await cam.evaluate(() => localStorage.removeItem('rs.cam.cred'));
    await cam.close();
    await expect(studio.getByRole('button', { name: /Be right back slate/ })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 10_000 },
    );
    await studio
      .getByTestId('reconnect-panel')
      .getByRole('button', { name: 'Show reconnect code' })
      .click({ timeout: 15_000 });
    const again = await studio.getByTestId('pair-qr').getAttribute('data-url');
    cam = await camCtx.newPage();
    await cam.goto(again!);
    await cam.getByRole('button', { name: 'Join as camera' }).click();
    await expect(cutBack).toBeVisible({ timeout: 25_000 });
    await expect(studio.getByRole('button', { name: 'Let this phone in' })).toHaveCount(0);
    await cutBack.click();
    await onProgramme();
    await expect(cam.getByTestId('cam-tally')).toHaveText(/live/i);
  } finally {
    await endService(studio).catch(() => undefined);
    await camCtx.close();
    await studioCtx.close();
  }
});
