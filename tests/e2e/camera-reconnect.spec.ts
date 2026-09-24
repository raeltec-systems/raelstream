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
