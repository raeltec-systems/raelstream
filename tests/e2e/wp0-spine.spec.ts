import { expect, test, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config.js';
import { e2eUser, signIn } from './auth.js';

const auth = 'Basic ' + Buffer.from('supervisor:dev-internal').toString('base64');

async function mediamtxPaths(page: Page) {
  const r = await page.request.get(`${E2E.mediamtxApi}/v3/paths/list`, {
    headers: { Authorization: auth },
  });
  expect(r.ok()).toBe(true);
  return (await r.json()) as { items: Array<{ name: string; ready: boolean; tracks: string[] }> };
}

/**
 * M1 exit evidence (PLAN §2): pair a fake-camera phone, receive it directly, capture fake mixer audio,
 * compose the programme and publish it over WHIP to a real MediaMTX behind the control auth hook.
 */
test('WP0 spine: pair → direct camera → audio → compose → WHIP ingest', async ({
  browser,
}, info) => {
  const studioCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const studio = await studioCtx.newPage();
  await studio.goto('/studio');

  // Real sign-in (password + authenticator code) and a new service
  await signIn(studio, e2eUser('spine'));
  await studio.getByRole('button', { name: 'Start without a saved service' }).click();
  await expect(studio.getByRole('heading', { name: 'Connect the camera' })).toBeVisible();

  // Pairing QR (secret in the fragment)
  await studio.getByRole('button', { name: 'Show pairing code' }).click();
  const qr = studio.getByTestId('pair-qr');
  await expect(qr).toBeVisible();
  const url = await qr.getAttribute('data-url');
  expect(url).toMatch(/\/cam#t=[A-Za-z0-9_-]{43}$/);

  // Phone joins
  const camCtx = await browser.newContext({
    permissions: ['camera'],
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const cam = await camCtx.newPage();
  await cam.goto(url!);
  await expect(cam.getByText('Sunday Service')).toBeVisible();
  expect(new URL(cam.url()).hash).toBe(''); // fragment cleared (PAIR-02)
  await cam.getByRole('button', { name: 'Join as camera' }).click();
  const phrase = await cam.getByTestId('cam-phrase').textContent();
  expect(phrase).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);

  // Studio verifies the phrase and admits
  await expect(studio.getByTestId('studio-phrase')).toHaveText(phrase!);
  await studio.getByRole('button', { name: 'Let this phone in' }).click();
  await cam.getByRole('button', { name: 'Start camera' }).click();

  // Direct link established, frames arriving, honest route label
  await expect(studio.getByText('Connected directly')).toBeVisible({ timeout: 20_000 });
  await expect(studio.getByText('Direct link, location not verified')).toBeVisible();
  await expect(cam.getByTestId('cam-tally')).toHaveText(/ready/i);
  await studio.screenshot({ path: info.outputPath('01-preparation-devices.png') });
  await cam.screenshot({ path: info.outputPath('02-camera-ready.png') });

  // Mixer audio (fake device beeps)
  await studio.getByRole('button', { name: /^5\s*Audio$/ }).click();
  const select = studio.getByLabel('Audio input');
  const values = await select
    .locator('option')
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  expect(values.length).toBeGreaterThan(0);
  await select.selectOption(values[0]!);
  await expect(studio.getByText('Sound detected')).toBeVisible({ timeout: 20_000 });

  // Delay control clamps and applies (SYNC-01)
  const delay = studio.getByLabel('Audio delay in milliseconds');
  await delay.fill('2345');
  await delay.press('Enter');
  await expect(studio.getByText('Applied: 2000 ms (0–2000 ms)')).toBeVisible();
  await studio.getByRole('button', { name: 'Reset' }).click();
  await expect(studio.getByText('Applied: 0 ms (0–2000 ms)')).toBeVisible();
  await studio.screenshot({ path: info.outputPath('03-preparation-audio.png') });

  // Add a lower third to the rundown
  await studio.getByRole('button', { name: /^4\s*Rundown$/ }).click();
  await studio.getByRole('button', { name: 'Add item' }).click();
  await studio.getByLabel('Title in the rundown').fill('Pastor Mwansa Banda');
  await studio.getByLabel('Name', { exact: true }).fill('Pastor Mwansa Banda');
  await studio.getByLabel('Second line').fill('Sunday sermon · Psalm 23');

  // Open the Studio
  await studio.getByRole('button', { name: /^5\s*Audio$/ }).click();
  await studio.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(studio.getByText('Programme preview - before platform delay')).toBeVisible();

  // Shortcut 2 = camera only; tally reaches the phone as LIVE
  await studio.locator('body').click({ position: { x: 5, y: 300 } });
  await studio.keyboard.press('2');
  await expect(studio.getByRole('button', { name: /Camera only/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(cam.getByTestId('cam-tally')).toHaveText(/live/i);

  // Take next puts the lower third on air
  await studio.getByRole('button', { name: /Take next/ }).click();
  await expect(studio.getByRole('button', { name: /Camera \+ lower third/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Programme canvas really draws the camera (not black)
  const lit = await studio.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const g = c.getContext('2d')!;
    const d = g.getImageData(c.width / 2 - 50, c.height / 2 - 50, 100, 100).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
    return sum / (d.length / 4);
  });
  expect(lit).toBeGreaterThan(10);

  // Private ingest test: WHIP to MediaMTX through the control auth hook
  await studio.getByRole('button', { name: 'Start private test' }).click();
  await expect(studio.getByText('server receiving')).toBeVisible({ timeout: 30_000 });
  const sessionId = await studio.evaluate(
    async () => (await (await fetch('/api/sessions/active')).json()).id as string,
  );
  await expect
    .poll(
      async () => {
        const p = (await mediamtxPaths(studio)).items.find(
          (i) => i.name === `live/${sessionId}/g1/contrib`,
        );
        return p ? { ready: p.ready, tracks: [...p.tracks].sort() } : null;
      },
      { timeout: 20_000 },
    )
    .toMatchObject({ ready: true });
  const path = (await mediamtxPaths(studio)).items.find(
    (i) => i.name === `live/${sessionId}/g1/contrib`,
  )!;
  expect(path.tracks.some((t) => /H264|VP8/.test(t))).toBe(true);
  expect(path.tracks).toContain('Opus');
  if (E2E.relay) {
    // Private host routes are refused, so everything flows through the TURN server: the studio sends
    // from its relay allocation, and MediaMTX answers from its relay allocation or from the address the
    // TURN server saw (server-reflexive). Both exist in a Codespace; never a direct host path.
    const webrtcSessions = async () => {
      const r = await studio.request.get(`${E2E.mediamtxApi}/v3/webrtcsessions/list`, {
        headers: { Authorization: auth },
      });
      return (await r.json()).items as Array<{
        localCandidate: string;
        remoteCandidate: string;
        bytesReceived: number;
      }>;
    };
    const [first] = await webrtcSessions();
    expect(first!.localCandidate).toMatch(/^(relay|srflx)\//);
    expect(first!.remoteCandidate).toMatch(/^relay\//);
    // media keeps flowing through the relay, not just the first packets
    await expect
      .poll(async () => (await webrtcSessions())[0]?.bytesReceived ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(500_000);
  }
  await studio.waitForTimeout(3000); // let stats accumulate for the screenshot
  await studio.screenshot({ path: info.outputPath('04-studio-live-private-test.png') });
  await cam.screenshot({ path: info.outputPath('05-camera-live.png') });

  await studio.getByRole('button', { name: 'Stop private test' }).click();
  await expect(studio.getByText('Not sending')).toBeVisible();

  await camCtx.close();
  await studioCtx.close();
});

test('an unauthenticated WHIP publish is refused by the auth hook (A42)', async ({ request }) => {
  const r = await request.post(
    `${E2E.web}/whip/live/00000000-0000-0000-0000-000000000000/g1/contrib/whip`,
    {
      headers: { 'Content-Type': 'application/sdp' },
      data: 'v=0\r\n',
    },
  );
  expect([401, 403]).toContain(r.status());
});
