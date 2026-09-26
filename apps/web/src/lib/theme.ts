import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/source-serif-4/index.css';
import type { Theme, ThemeFont } from '@raelstream/contracts';
import type { ProgrammeTheme } from '@raelstream/media-runtime';

/** The three bundled on-air fonts (SPEC §10.5), all served same-origin. */
export const FONT_FAMILY: Record<ThemeFont, string> = {
  inter: "'Inter Variable', sans-serif",
  source_serif_4: "'Source Serif 4 Variable', serif",
  atkinson: "'Atkinson Hyperlegible', sans-serif",
};

/** Canvas text only uses a web font once it is loaded, so load both weights before rendering. */
export async function loadFont(font: ThemeFont): Promise<void> {
  const family = FONT_FAMILY[font];
  await Promise.all(
    ['400', '700'].map((w) => document.fonts.load(`${w} 48px ${family}`).catch(() => [])),
  );
}

const bitmaps = new Map<string, Promise<ImageBitmap | null>>();

/** Decoded image for an uploaded asset (cached per page; assets are immutable). */
export function assetBitmap(id: string | null | undefined): Promise<ImageBitmap | null> {
  if (!id) return Promise.resolve(null);
  let p = bitmaps.get(id);
  if (!p) {
    p = fetch(`/api/assets/${id}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => createImageBitmap(b))
      .catch(() => {
        bitmaps.delete(id);
        return null;
      });
    bitmaps.set(id, p);
  }
  return p;
}

/** Derive a lighter variant of the main colour for dark surfaces. */
function lighten(hex: string, f = 0.45): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${c
    .map((v) =>
      Math.round(v + (255 - v) * f)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** The church theme as the compositor needs it: colours, loaded font and decoded images. */
export async function programmeTheme(theme: Theme): Promise<Partial<ProgrammeTheme>> {
  const [logo, holding] = await Promise.all([
    assetBitmap(theme.logoAssetId),
    assetBitmap(theme.holdingAssetId),
    loadFont(theme.font),
  ]);
  return {
    accent: theme.primaryColor,
    accentDark: lighten(theme.primaryColor),
    secondary: theme.secondaryColor,
    background: theme.backgroundColor,
    font: FONT_FAMILY[theme.font],
    churchName: theme.churchName,
    logo,
    logoCorner: theme.logoCorner,
    logoScale: theme.logoScale,
    holding,
    lowerThirdMotion: theme.lowerThirdMotion,
  };
}
