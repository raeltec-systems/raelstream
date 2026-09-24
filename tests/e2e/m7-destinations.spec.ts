import { expect, test, type Page } from '@playwright/test';
import { e2eUser, endService, signIn } from './auth.js';

async function pasteFromClipboard(page: Page, text: string, button: ReturnType<Page['getByRole']>) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await button.click();
}

/**
 * M7: the owner sets up destinations in Settings (keys write-only), the operator runs the uplink test,
 * pastes this service's Facebook key (I-13), and Go live only offers destinations that have a key.
 */
test('destinations, Facebook per-service key and the uplink test', async ({ browser }, info) => {
  const ctx = await browser.newContext({
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  try {
    await page.goto('/studio');
    await signIn(page, e2eUser('destinations'));
    await page.getByRole('button', { name: 'Settings' }).click();

    // YouTube with a persistent key: pasted, locked on the server, only the ending shown.
    await page.getByRole('button', { name: 'Add YouTube' }).click();
    const form = page.getByTestId('dest-form');
    await form.getByLabel('Name').fill('Grace Chapel YouTube');
    await form.getByRole('radio', { name: 'Same key every week' }).click();
    await pasteFromClipboard(
      page,
      'yt-e2e-secret-4321',
      form.getByRole('button', { name: 'Paste' }),
    );
    await expect(form.getByText('••••4321')).toBeVisible();
    await form.getByRole('radio', { name: 'Waits for Go Live' }).click();
    await form.getByRole('button', { name: 'Save destination' }).click();
    await expect(page.getByText('Key saved (••••4321)')).toBeVisible();
    await expect(page.getByText('yt-e2e-secret')).toHaveCount(0);

    // Facebook: a new key each service by default.
    await page.getByRole('button', { name: 'Add Facebook' }).click();
    await form.getByLabel('Name').fill('Grace Chapel Facebook');
    await expect(form.getByRole('radio', { name: 'New key each service' })).toBeChecked();
    await form.getByRole('button', { name: 'Save destination' }).click();
    await expect(page.getByText('New key each service (pasted in Preparation)')).toBeVisible();
    await page.screenshot({
      path: info.outputPath('01-settings-destinations.png'),
      fullPage: true,
    });

    // A service: the uplink test measures and suggests a profile.
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Start without a saved service' }).click();
    await page.getByRole('button', { name: /^2\s*Uplink test$/ }).click();
    await expect(page.getByText('Upload not measured')).toBeVisible();
    await page.getByRole('button', { name: 'Run uplink test' }).click();
    await expect(page.getByTestId('uplink-offer')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('uplink-mbps')).toContainText('Mb/s upload');

    // Destinations: Facebook blocks readiness until this service's key is pasted.
    await page.getByRole('button', { name: /^3\s*Destinations$/ }).click();
    await expect(page.getByText('Facebook key needed for this service')).toBeVisible();
    await expect(page.getByRole('status')).toContainText("paste Facebook's key for this service");
    await pasteFromClipboard(
      page,
      'FB-e2e-2026-0924-9876',
      page.getByRole('button', { name: 'Paste' }),
    );
    await expect(page.getByText('••••9876')).toBeVisible();
    await expect(page.getByRole('status')).not.toContainText("paste Facebook's key for this service");
    await expect(page.getByText('YouTube waits for you')).toBeVisible();
    await page.screenshot({ path: info.outputPath('02-prep-destinations.png'), fullPage: true });

    // Go live offers both, now that each has a key.
    await page.goto('/studio/live');
    await page.getByRole('button', { name: 'Go live…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { name: /Grace Chapel Facebook/ })).toBeEnabled();
    await expect(dialog.getByRole('checkbox', { name: /Grace Chapel YouTube/ })).toBeChecked();
    await expect(dialog.getByText(/Record a private copy/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  } finally {
    await endService(page).catch(() => undefined);
    await ctx.close();
  }
});
