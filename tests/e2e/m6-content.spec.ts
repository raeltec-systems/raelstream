import { expect, test, type Page } from '@playwright/test';
import { e2eUser, endService, signIn } from './auth.js';
import { pairCamera } from './pair.js';

// 120×60 opaque magenta PNG (with an alpha channel, so the server keeps it as PNG).
const LOGO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAYAAACtrX6oAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABLUlEQVR4nO2VwQ3AMBCDvP/SdIrKvpYH/8iEJASEz26Q9gEEBXsJsGAvAT7R/PBL8A9OX4KCB4biKBacvgQFDwzFUSw4fQkKHhiKo1hw+hIUPDAUR7Hg9CUoeGAojmLB6UtQ8MBQHMWC05eg4IGhOIoFpy9BwQNDcRQLTl+CggeG4igWnL4EBQ8MxVEsOH0JCh4YiqNYcPoSFDwwFEex4PQlKHhgKI5iwelLUPDAUBzFgtOXoOCBoTiKBacvQcEDQ3EUC05fgoIHhuIoFpy+BAUPDMVRLDh9CQoeGIqjWHD6EhQ8MBRHseD0JSh4YCiOYsHpS1DwwFAcxYLTl6DggaE4igWnL0HBA0NxFAtOX4KCB4biKBacvgQFDwzFUSw4fQkKHhiKo1hw+hLe5AFYDRCNPOlRrQAAAABJRU5ErkJggg==',
  'base64',
);

/** Mean RGB of a square of the programme canvas, in 1920×1080 reference coordinates. */
function sample(page: Page, x: number, y: number, size = 20) {
  return page.evaluate(
    ({ x, y, size }) => {
      const c = document.querySelector('canvas')!;
      const k = c.width / 1920;
      const d = c.getContext('2d')!.getImageData(x * k, y * k, size * k, size * k).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (const j of [0, 1, 2]) sum[j]! += d[i + j]!;
      return sum.map((v) => Math.round(v / (d.length / 4)));
    },
    { x, y, size },
  );
}

/**
 * M6: the church look (logo in the chosen corner on the real programme), uploaded rundown images that
 * survive a reload, refusal of unsafe files (A24), and the lip-sync clip tool end to end.
 */
test('church look, uploaded images, and the lip-sync clip tool', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const studio = await ctx.newPage();
  try {
    await studio.goto('/studio');
    await signIn(studio, e2eUser('content'));

    // Settings → church look: logo bottom-left, a darker main colour, serif font.
    await studio.getByRole('button', { name: 'Settings' }).click();
    await studio.getByLabel('Logo', { exact: true }).setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: LOGO,
    });
    await studio.getByRole('radio', { name: 'Bottom left' }).click();
    // An unreadable main colour is caught before saving.
    await studio.locator('input[type=color]').first().fill('#ffe680');
    await expect(studio.getByText(/It needs at least 4\.5:1/)).toBeVisible();
    await expect(studio.getByRole('button', { name: 'Save church look' })).toBeDisabled();
    await studio.locator('input[type=color]').first().fill('#7a1f2b');
    await studio.getByRole('radio', { name: 'Source Serif' }).click();
    await studio.getByRole('button', { name: 'Save church look' }).click();
    await expect(studio.getByRole('button', { name: 'Saved' })).toBeVisible();
    await studio.screenshot({ path: info.outputPath('01-church-look.png'), fullPage: true });

    // A service: an SVG is refused with an explanation; a real image is checked and kept.
    await studio.getByRole('button', { name: 'Back' }).click();
    await studio.getByRole('button', { name: 'Start without a saved service' }).click();
    await studio.getByRole('button', { name: /^4\s*Rundown$/ }).click();
    await studio.getByRole('button', { name: 'Add item' }).click();
    await studio.getByRole('radio', { name: 'Image', exact: true }).click();
    await studio.getByLabel(/^Image file/).setInputFiles({
      name: 'evil.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    });
    await expect(studio.getByRole('alert')).toContainText('no SVG or animations');
    await studio.getByLabel(/^Image file/).setInputFiles({
      name: 'welcome.png',
      mimeType: 'image/png',
      buffer: LOGO,
    });
    await expect(studio.getByText('Image ready · 120×60')).toBeVisible();

    // A scripture card with a reference; far too much text is refused before it can go on air.
    await studio.getByRole('button', { name: 'Add item' }).click();
    await studio.getByRole('radio', { name: 'Text card', exact: true }).click();
    await studio
      .getByLabel('Text', { exact: true })
      .fill(Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join('\n'));
    await expect(studio.getByText(/Text too long for the card/)).toBeVisible();
    await studio
      .getByLabel('Text', { exact: true })
      .fill('The Lord is my shepherd; I shall not want.');
    await studio.getByLabel('Reference (optional)').fill('Psalm 23:1');
    await expect(studio.getByText(/Text too long for the card/)).toHaveCount(0);

    // Reload: the image comes back from the server, not from this tab's memory.
    await studio.waitForTimeout(1200); // rundown save is debounced
    await studio.reload();
    await studio.getByRole('button', { name: /^4\s*Rundown$/ }).click();
    await studio
      .getByRole('button', { name: /Image$/ })
      .first()
      .click();
    await expect(studio.getByText('Image ready · 120×60')).toBeVisible({ timeout: 10_000 });

    // Audio + open the studio: the logo is on the real programme, bottom-left.
    await studio.getByRole('button', { name: /^5\s*Audio$/ }).click();
    const select = studio.getByLabel('Audio input');
    const input = select.locator('option:not([value=""]):not([value="rs:phone"])').first();
    await select.selectOption((await input.getAttribute('value'))!);
    await expect(studio.getByText(/Sound detected|No sound yet/)).toBeVisible();

    // Lip-sync clip tool: record the programme, find the fake microphone's beep, mark a frame, save.
    await expect(studio.getByTestId('sync-status')).toHaveText('Not calibrated yet');
    await studio.getByRole('button', { name: /Record a 20 s test clip/ }).click();
    await studio.waitForTimeout(4000);
    await studio.getByRole('button', { name: 'Stop early' }).click();
    await expect(studio.getByTestId('sync-clip')).toBeVisible({ timeout: 15_000 });
    await expect(studio.getByText(/Clap sound detected at/)).toBeVisible();
    // The clip plays with its sound, and the pictures around the clap are offered to pick from.
    await expect(studio.getByTestId('sync-clip')).toHaveJSProperty('muted', false);
    const frames = studio.getByTestId('sync-strip').getByRole('option');
    await expect(frames).toHaveCount(20, { timeout: 15_000 });
    await frames.nth(12).click();
    await expect(frames.nth(12)).toHaveAttribute('aria-selected', 'true');
    const result = studio.getByTestId('sync-result');
    await expect(result).toBeVisible();
    const use = studio.getByRole('button', { name: /^Use \d+ ms$/ });
    if (await use.count()) await use.click();
    const save = studio.getByRole('button', { name: /Save calibration|Record this failed check/ });
    await save.click();
    await expect(studio.getByText(/Calibration saved\.|Failed check recorded\./)).toBeVisible();
    await studio.screenshot({ path: info.outputPath('02-sync-tool.png'), fullPage: true });

    const { camCtx } = await pairCamera(browser, studio);
    await studio.getByRole('button', { name: /^5\s*Audio$/ }).click();
    await studio.getByRole('button', { name: 'Open the Studio' }).click();
    await studio.getByRole('button', { name: /Camera only/ }).click();
    await expect
      .poll(async () => sample(studio, 48 + 40, 1080 - 48 - 40), { timeout: 10_000 })
      .toEqual([255, 0, 255]);
    await studio.screenshot({ path: info.outputPath('03-programme-with-logo.png') });
    await camCtx.close();
  } finally {
    await endService(studio).catch(() => undefined);
    await ctx.close();
  }
});
