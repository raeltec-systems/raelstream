import { expect, type Browser, type Page } from '@playwright/test';

/** Pair a fake-camera phone with the studio's current service and wait for the direct link. */
export async function pairCamera(browser: Browser, studio: Page) {
  await studio.getByRole('button', { name: /^1\s*Devices$/ }).click();
  await studio.getByRole('button', { name: 'Show pairing code' }).click();
  const url = await studio.getByTestId('pair-qr').getAttribute('data-url');
  const camCtx = await browser.newContext({
    permissions: ['camera'],
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const cam = await camCtx.newPage();
  await cam.goto(url!);
  await cam.getByRole('button', { name: 'Join as camera' }).click();
  await expect(studio.getByTestId('studio-phrase')).toBeVisible();
  await studio.getByRole('button', { name: 'Let this phone in' }).click();
  await cam.getByRole('button', { name: 'Start camera' }).click();
  await expect(studio.getByText('Connected directly')).toBeVisible({ timeout: 20_000 });
  return { cam, camCtx };
}
