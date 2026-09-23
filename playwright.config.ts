import { defineConfig } from '@playwright/test';

const executablePath =
  process.env.RS_CHROMIUM_PATH ?? (process.env.CI ? undefined : '/opt/pw-browsers/chromium');
export const E2E = {
  web: 'http://localhost:5173',
  control: 'http://127.0.0.1:3000',
  mediamtxApi: 'http://127.0.0.1:9997',
  dbAdmin:
    process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://raelstream:dev@localhost:55432/raelstream',
  broadcast: process.env.RS_E2E_BROADCAST === '1',
  // TEST-ONLY sealed-box keypair for the broadcast e2e run. Never used outside automated tests.
  sealPublicKey: 'jYpBKnSnxZqDHCwq9fg-qyqIwEo8gyOz9mMDW3PIXh8',
  sealSecretKey: 'YVuLOwVF8VFS-ZGdja17j1_gdwMTyxR3MsfQkkbEsJw',
};

/**
 * Synthetic browser tests (SPEC §21). Fake media devices make runs repeatable; they do NOT qualify the
 * real phone, laptop, interface or Wi-Fi (B§26.1).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: E2E.web,
    viewport: { width: 1366, height: 768 },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        // Host candidates as raw IPs: mDNS resolution is not available in CI containers. The real
        // devices use mDNS; proving that works is part of the WP0 hardware run (G2).
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command:
        'pnpm --filter @raelstream/control exec sh -c "tsx test/e2e-prepare.ts && exec tsx src/server.ts"',
      url: `${E2E.control}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E.dbAdmin.replace(/\/[^/]+$/, '/rs_e2e'),
        PUBLIC_ORIGIN: E2E.web,
        WHIP_PUBLIC_BASE: `${E2E.web}/whip`,
        RS_PAIR_RATE_LIMIT: '1000',
        RS_LOGIN_RATE_LIMIT: '1000',
        RS_SEAL_PUBLIC_KEY: E2E.sealPublicKey,
        RS_E2E_SEAL_SECRET_KEY: E2E.sealSecretKey,
        RS_DEST_TEST_SINKS: '1',
        RS_E2E_BROADCAST: E2E.broadcast ? '1' : '0',
        PORT: '3000',
        HOST: '127.0.0.1',
      },
    },
    {
      command: 'pnpm --filter @raelstream/web exec vite --port 5173 --strictPort',
      url: E2E.web,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
