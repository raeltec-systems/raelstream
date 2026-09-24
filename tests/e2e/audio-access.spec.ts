import { expect, test } from '@playwright/test';
import { e2eUser, endService, signIn } from './auth.js';

/**
 * Before microphone permission, browsers list anonymous inputs with no ID or name, and picking one did
 * nothing (seen on the owner's Dell). The studio must ask for access first. The pre-permission state is
 * simulated in the page so the test does not depend on how a given Chromium build grants permissions.
 */
test('audio inputs appear by name after allowing microphone access', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addInitScript(() => {
    const md = navigator.mediaDevices;
    const enumerate = md.enumerateDevices.bind(md);
    const gum = md.getUserMedia.bind(md);
    let allowed = false;
    md.getUserMedia = async (c) => {
      const s = await gum(c);
      allowed = true;
      return s;
    };
    md.enumerateDevices = async () =>
      allowed
        ? enumerate()
        : (await enumerate()).map(
            (d) => ({ kind: d.kind, deviceId: '', label: '', groupId: '' }) as MediaDeviceInfo,
          );
  });
  const page = await ctx.newPage();
  try {
    await page.goto('/studio');
    await signIn(page, e2eUser('audio'));
    await page.getByRole('button', { name: 'Start without a saved service' }).click();
    await page.getByRole('button', { name: /^5\s*Audio$/ }).click();

    // Before permission: an explanation and a button, no unselectable anonymous entries.
    await expect(page.getByText(/Allow microphone access so the studio can list/)).toBeVisible();
    const select = page.getByLabel('Audio input');
    await expect(select.locator('option:not([value=""])')).toHaveCount(0);

    await page.getByRole('button', { name: 'Allow microphone access' }).click();
    await expect(page.getByText(/Allow microphone access so the studio can list/)).toHaveCount(0);
    await expect(
      page.getByText(/blocked microphone access|No audio inputs were found/),
    ).toHaveCount(0);

    const named = select.locator('option:not([value=""])');
    await expect(named.first()).toBeAttached();
    const value = (await named.first().getAttribute('value'))!;
    await select.selectOption(value);
    await expect(select).toHaveValue(value); // it stays selected
    await expect(page.getByText(/Sound detected|No sound yet/)).toBeVisible();
  } finally {
    // Never leave a service open for the next spec, even when this one fails.
    await endService(page).catch(() => undefined);
    await ctx.close();
  }
});
