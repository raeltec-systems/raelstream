import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config.js';
import { e2eUser, endService, signIn } from './auth.js';

/**
 * The production build under the production Content-Security-Policy (read from infra/proxy/Caddyfile).
 * The dev server sends no CSP, which is how a blocked audio worklet reached the owner's Codespace. Every
 * screen below must work with zero policy violations.
 */
async function watchCsp(ctx: BrowserContext) {
  await ctx.addInitScript(() => {
    (window as unknown as { rsCsp: string[] }).rsCsp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { rsCsp: string[] }).rsCsp.push(
        `${e.violatedDirective} ${e.blockedURI.slice(0, 60)} at ${e.sourceFile.split('/').pop()}:${e.lineNumber}:${e.columnNumber}`,
      ),
    );
  });
}
const violations = (p: Page) => p.evaluate(() => (window as unknown as { rsCsp: string[] }).rsCsp);

test('production build: studio and camera run under the production CSP', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({
    baseURL: E2E.prod,
    permissions: ['camera', 'microphone'],
  });
  await watchCsp(ctx);
  const studio = await ctx.newPage();
  const camCtx = await browser.newContext({
    baseURL: E2E.prod,
    permissions: ['camera'],
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  await watchCsp(camCtx);
  try {
    const csp = (await (await studio.request.get('/studio')).headers())['content-security-policy'];
    expect(csp).toContain("script-src 'self'");

    await studio.goto('/studio');
    await signIn(studio, e2eUser('csp'));
    // Settings renders the on-air preview with the theme fonts.
    await studio.getByRole('button', { name: 'Settings' }).click();
    await expect(studio.getByTestId('theme-preview')).toBeVisible();
    await studio.getByRole('radio', { name: 'Source Serif' }).click();
    await studio.getByRole('button', { name: 'Back' }).click();

    await studio.getByRole('button', { name: 'Start without a saved service' }).click();
    // UI fonts are same-origin files, not blocked data: URLs.
    expect(
      await studio.evaluate(async () => {
        await document.fonts.ready;
        return document.fonts.check('700 16px "Bricolage Grotesque Variable"');
      }),
    ).toBe(true);

    // Phone pairing on the production build.
    await studio.getByRole('button', { name: 'Show pairing code' }).click();
    const url = new URL((await studio.getByTestId('pair-qr').getAttribute('data-url'))!);
    const cam = await camCtx.newPage();
    await cam.goto(`/cam${url.hash}`);
    await cam.getByRole('button', { name: 'Join as camera' }).click();
    await studio.getByRole('button', { name: 'Let this phone in' }).click();
    await cam.getByRole('button', { name: 'Start camera' }).click();
    await expect(studio.getByText('Connected directly')).toBeVisible({ timeout: 20_000 });

    // Audio meters (AudioWorklet) and the uplink test.
    await studio.getByRole('button', { name: /^5\s*Audio$/ }).click();
    const select = studio.getByLabel('Audio input');
    const input = select.locator('option:not([value=""]):not([value="rs:phone"])').first();
    await select.selectOption((await input.getAttribute('value'))!);
    await expect(studio.getByText('Sound detected')).toBeVisible({ timeout: 20_000 });

    // Live: programme canvas, then the WHIP contribution.
    await studio.getByRole('button', { name: 'Open the Studio' }).click();
    await studio.getByRole('button', { name: /Camera only/ }).click();
    await studio.getByRole('button', { name: 'Start private test' }).click();
    await expect(studio.getByText('server receiving')).toBeVisible({ timeout: 30_000 });
    await studio.getByRole('button', { name: 'Stop private test' }).click();

    expect(await violations(studio)).toEqual([]);
    expect(await violations(cam)).toEqual([]);
  } finally {
    await endService(studio).catch(() => undefined);
    await camCtx.close();
    await ctx.close();
  }
});
