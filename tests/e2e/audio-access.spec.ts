import { chromium, expect, test } from '@playwright/test';
import { e2eUser, endService, signIn } from './auth.js';

/**
 * Before microphone permission, browsers list anonymous inputs with no ID: the studio must ask for
 * access first instead of offering an entry that cannot be selected (seen on the owner's Dell).
 */
test('audio inputs appear by name after allowing microphone access', async () => {
  // A real first visit: fake devices, but no auto-granted permission (unlike the other specs).
  const launch = test.info().project.use.launchOptions ?? {};
  const browser = await chromium.launch({
    ...launch,
    args: (launch.args ?? []).filter((a) => a !== '--use-fake-ui-for-media-stream'),
  });
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await ctx.newPage();
  await page.goto('/studio');
  await signIn(page, e2eUser('audio'));
  await page.getByRole('button', { name: 'Start without a saved service' }).click();
  await page.getByRole('button', { name: /^5\s*Audio$/ }).click();

  await expect(page.getByText(/Allow microphone access so the studio can list/)).toBeVisible();
  await ctx.grantPermissions(['microphone']);
  await page.getByRole('button', { name: 'Allow microphone access' }).click();
  await expect(page.getByText(/Allow microphone access so the studio can list/)).toHaveCount(0);

  const select = page.getByLabel('Audio input');
  const named = select.locator('option:not([value=""])');
  await expect(named.first()).toBeAttached();
  const value = (await named.first().getAttribute('value'))!;
  expect(value).not.toBe('');
  await select.selectOption(value);
  await expect(select).toHaveValue(value); // it stays selected
  await expect(page.getByText(/Sound detected|No sound yet/)).toBeVisible();

  await endService(page);
  await browser.close();
});
