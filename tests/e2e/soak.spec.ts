import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { e2eUser, endService, signIn } from './auth.js';
import { pairCamera } from './pair.js';

/**
 * Soak (A26, synthetic): the whole studio workload for RS_SOAK_MINUTES (skipped when unset): fake
 * phone camera, fake mixer audio, compositing with graphics, and the WHIP contribution to the media
 * server. Checks that the tab's memory does not keep growing, the programme keeps moving, the upload
 * stays connected and the camera never falsely drops to the slate. Writes the evidence to
 * soak-evidence.json in the test's results folder. The qualifying 3-hour run uses the real Dell, phone and UMC
 * (docs/runbooks/wp0-hardware-run.md); this proves the software side can run that long.
 */
const minutes = Number(process.env.RS_SOAK_MINUTES ?? 0);

test('soak: studio workload stays stable', async ({ browser }, info) => {
  test.skip(!minutes, 'set RS_SOAK_MINUTES to run the soak');
  test.setTimeout((minutes + 3) * 60_000);
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const studio = await ctx.newPage();
  const samples: Array<Record<string, number | string | boolean | null>> = [];
  let camCtx: { close: () => Promise<void> } | null = null;
  try {
    await studio.goto('/studio');
    await signIn(studio, e2eUser('soak'));
    await studio.getByRole('button', { name: 'Start without a saved service' }).click();
    ({ camCtx } = await pairCamera(browser, studio));
    await studio.getByRole('button', { name: /^4\s*Rundown$/ }).click();
    await studio.getByRole('button', { name: 'Add item' }).click();
    await studio.getByLabel('Name', { exact: true }).fill('Pastor Mwansa Banda');
    await studio.getByRole('button', { name: /^5\s*Audio$/ }).click();
    const select = studio.getByLabel('Audio input');
    const input = select.locator('option:not([value=""]):not([value="rs:phone"])').first();
    await select.selectOption((await input.getAttribute('value'))!);
    await studio.getByRole('button', { name: 'Open the Studio' }).click();
    await studio.getByRole('button', { name: /Take next/ }).click(); // camera + lower third
    await studio.getByRole('button', { name: 'Start private test' }).click();
    await expect(studio.getByText('server receiving')).toBeVisible({ timeout: 30_000 });
    const sessionId = await studio.evaluate(
      async () => (await (await fetch('/api/sessions/active')).json()).id as string,
    );

    const hash = () =>
      studio.evaluate(() => {
        const c = document.querySelector('canvas')!;
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let h = 0;
        for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]!) | 0;
        return h;
      });
    const end = Date.now() + minutes * 60_000;
    while (Date.now() < end) {
      await studio.waitForTimeout(30_000);
      const before = await hash();
      await studio.waitForTimeout(500);
      samples.push({
        t: Math.round((Date.now() - (end - minutes * 60_000)) / 1000),
        heapMb: await studio.evaluate(() =>
          Math.round(
            ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
              ?.usedJSHeapSize ?? 0) / 1e6,
          ),
        ),
        programmeMoving: (await hash()) !== before,
        sending: await studio.getByText('server receiving').isVisible(),
        slate: await studio
          .getByRole('button', { name: /Be right back slate/ })
          .getAttribute('aria-pressed')
          .then((v) => v === 'true'),
      });
    }
    const report = await (await studio.request.get(`/api/sessions/${sessionId}/report`)).json();
    writeFileSync(
      info.outputPath('soak-evidence.json'),
      JSON.stringify(
        { minutes, samples, stats: report.stats, qualityChanges: report.qualityChanges },
        null,
        2,
      ),
    );

    expect(samples.every((s) => s.programmeMoving)).toBe(true);
    expect(samples.every((s) => s.sending)).toBe(true);
    expect(samples.some((s) => s.slate)).toBe(false);
    // Memory: after warm-up (first 2 samples), growth stays under 50 %.
    const heaps = samples.map((s) => s.heapMb as number).filter((h) => h > 0);
    if (heaps.length > 3) expect(heaps.at(-1)!).toBeLessThan(Math.max(heaps[1]!, heaps[2]!) * 1.5);
    expect(report.stats.cameraFps).not.toBeNull();
  } finally {
    await endService(studio).catch(() => undefined);
    await camCtx?.close();
    await ctx.close();
  }
});
