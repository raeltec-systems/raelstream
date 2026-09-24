import { z } from 'zod';

/** Church theme (SPEC §10.5): logo, two colours, one bundled font, fixed layouts. */
export const THEME_FONTS = ['inter', 'source_serif_4', 'atkinson'] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const Theme = z.object({
  churchName: z.string().trim().max(60).default(''),
  logoAssetId: z.string().uuid().nullable().default(null),
  logoCorner: z.enum(['tl', 'tr', 'bl', 'br']).default('tr'),
  /** Logo width as a fraction of the frame width. */
  logoScale: z.number().min(0.06).max(0.15).default(0.08),
  primaryColor: Hex.default('#2F6FCF'),
  secondaryColor: Hex.default('#1F2320'),
  backgroundColor: Hex.default('#161A18'),
  font: z.enum(THEME_FONTS).default('inter'),
  /** Optional full-frame image for the holding ("be right back") scene. */
  holdingAssetId: z.string().uuid().nullable().default(null),
});
export type Theme = z.infer<typeof Theme>;

export const DEFAULT_CHURCH_THEME: Theme = Theme.parse({});

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** WCAG contrast ratio between two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** White text sits on the main colour (text cards, lower-third accent): it must reach 4.5:1. */
export const MIN_TEXT_CONTRAST = 4.5;
export function primaryReadable(hex: string): boolean {
  return contrastRatio(hex, '#FFFFFF') >= MIN_TEXT_CONTRAST;
}
