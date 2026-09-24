import { expect, test } from '@playwright/test';
import { e2eUser, endService, signIn } from './auth.js';

/**
 * The camera phone as the sound source (SPEC §8.8 decision): silent until the operator picks it, then
 * its microphone (Chromium's fake device beeps) reaches the studio meters. Picking a laptop input
 * stops the phone's microphone again.
 */
test('phone sound: off by default, on when the operator picks it, off again after', async ({
  browser,
}) => {
  const studioCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const studio = await studioCtx.newPage();
  const camCtx = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  // Count microphone opens on the phone: none may happen before the operator asks.
  await camCtx.addInitScript(() => {
    const md = navigator.mediaDevices;
    const gum = md.getUserMedia.bind(md);
    (window as unknown as { rsMicOpens: number }).rsMicOpens = 0;
    md.getUserMedia = async (c) => {
      if (c?.audio) (window as unknown as { rsMicOpens: number }).rsMicOpens++;
      return gum(c);
    };
  });
  const cam = await camCtx.newPage();
  const micOpens = () =>
    cam.evaluate(() => (window as unknown as { rsMicOpens: number }).rsMicOpens);
  try {
    await studio.goto('/studio');
    await signIn(studio, e2eUser('phone'));
    await studio.getByRole('button', { name: 'Start without a saved service' }).click();
    await studio.getByRole('button', { name: 'Show pairing code' }).click();
    const url = await studio.getByTestId('pair-qr').getAttribute('data-url');
    await cam.goto(url!);
    await cam.getByRole('button', { name: 'Join as camera' }).click();
    await expect(studio.getByTestId('studio-phrase')).toBeVisible();
    await studio.getByRole('button', { name: 'Let this phone in' }).click();
    await cam.getByRole('button', { name: 'Start camera' }).click();
    await expect(studio.getByText('Connected directly')).toBeVisible({ timeout: 20_000 });

    await studio.getByRole('button', { name: /^5\s*Audio$/ }).click();
    await studio.waitForTimeout(1000);
    expect(await micOpens()).toBe(0); // never on by default (C-04)
    await expect(cam.getByText('Sending sound to the studio')).toHaveCount(0);

    const select = studio.getByLabel('Audio input');
    const phone = select.locator('option', { hasText: /^Phone sound:/ });
    await expect(phone).toBeAttached();
    await select.selectOption((await phone.getAttribute('value'))!);

    await expect(cam.getByText('Sending sound to the studio')).toBeVisible({ timeout: 15_000 });
    await expect(studio.getByText('Sound detected')).toBeVisible({ timeout: 20_000 });
    await expect(studio.getByText(/choose the mixer audio input/)).toHaveCount(0);
    expect(await micOpens()).toBe(1);

    // Back to a laptop input: the phone stops sending and releases its microphone.
    const laptop = select.locator('option:not([value=""]):not([value="rs:phone"])').first();
    await select.selectOption((await laptop.getAttribute('value'))!);
    await expect(cam.getByText('Sending sound to the studio')).toHaveCount(0, { timeout: 10_000 });
    await expect(studio.getByText('Sound detected')).toBeVisible({ timeout: 20_000 });
  } finally {
    await endService(studio).catch(() => undefined);
    await camCtx.close();
    await studioCtx.close();
  }
});
