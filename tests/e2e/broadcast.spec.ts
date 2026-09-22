import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { E2E } from '../../playwright.config.js';

/**
 * M2 studio broadcast flow against the real supervisor and two local RTMP "platforms"
 * (RS_E2E_BROADCAST=1; needs the rs-supervisor:dev image). Checks the Start/Stop safety rules (SPEC §9.6),
 * live destination rows, partial publication and the ended state.
 */
test.skip(!E2E.broadcast, 'set RS_E2E_BROADCAST=1 (needs the supervisor image)');

function addDestination(
  platform: string,
  label: string,
  server: string,
  key: string,
  extra: string[] = [],
) {
  execFileSync(
    'pnpm',
    [
      '--filter',
      '@raelstream/control',
      'exec',
      'tsx',
      'src/cli.ts',
      'destination:add',
      '--platform',
      platform,
      '--label',
      label,
      '--server',
      server,
      ...extra,
    ],
    {
      input: key,
      env: {
        ...process.env,
        DATABASE_URL: E2E.dbAdmin.replace(/\/[^/]+$/, '/rs_e2e'),
        PUBLIC_ORIGIN: E2E.web,
        WHIP_PUBLIC_BASE: `${E2E.web}/whip`,
        RS_SEAL_PUBLIC_KEY: E2E.sealPublicKey,
        RS_DEST_TEST_SINKS: '1',
        NODE_ENV: 'test',
      },
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );
}

test('Go live → both sending → one platform lost → stop → ended', async ({ page }, info) => {
  addDestination('facebook', 'Grace Chapel Lusaka', 'rtmp://127.0.0.1:1936/fb', 'fb-e2e-key-0001');
  addDestination('youtube', 'Grace Chapel Live', 'rtmp://127.0.0.1:1937/yt', 'yt-e2e-key-0002', [
    '--auto-publish',
    'no',
  ]);

  await page.goto('/studio');
  await page.getByLabel('Your name').fill('Chanda');
  await page.getByLabel('Studio passphrase').fill(E2E.passphrase);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Start preparing' }).click();
  await page.goto('/studio/live');
  await expect(page.getByTestId('dest-facebook')).toContainText('Ready to test');

  // Start confirmation: Cancel has focus, so Enter cancels (SPEC §9.6)
  await page.getByRole('button', { name: 'Go live…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Viewers may see this as soon as video arrives.');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Go live…' }).click();
  await page.getByRole('button', { name: 'Start sending to 2 places' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ON AIR' })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByTestId('dest-facebook')).toContainText(/Sending/, { timeout: 30_000 });
  await expect(page.getByTestId('dest-youtube')).toContainText('publish it in YouTube Studio');
  await page.screenshot({ path: info.outputPath('01-live-on-air.png') });

  // One platform disappears: partial banner, the other keeps sending
  execFileSync('docker', ['rm', '-f', 'rs-e2e-sink-b'], { stdio: 'ignore' });
  await expect(page.getByText('Only Facebook Page is receiving the service')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('dest-youtube')).toContainText(/Reconnecting/);
  await expect(page.getByTestId('dest-facebook')).toContainText(/Sending/);
  await page.screenshot({ path: info.outputPath('02-partial.png') });

  // Stop confirmation: Keep streaming has focus; Enter never stops (I-11)
  await page.getByRole('button', { name: 'Stop streaming…' }).click();
  await expect(dialog).toContainText('Stop streaming to 2 places?');
  await expect(dialog.getByRole('button', { name: 'Keep streaming' })).toBeFocused();
  await page.screenshot({ path: info.outputPath('03-stop-modal.png') });
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'ON AIR' })).toBeVisible();

  await page.getByRole('button', { name: 'Stop streaming…' }).click();
  await page.getByRole('button', { name: 'Stop both' }).click();
  await expect(page.getByText('This service has ended')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: info.outputPath('04-ended.png') });
});
