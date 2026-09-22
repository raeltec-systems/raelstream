/** Church accent theming (design: accent is themeable; dark variant derived; ≥4.5:1 button text). */

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`invalid colour ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}

function luminance(hex: string): number {
  const c = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Lighten toward white until #101418 text reaches 4.5:1 on it. */
export function deriveAccentDark(accent: string): string {
  const base = hexToRgb(accent);
  for (let f = 0; f <= 1.0001; f += 0.02) {
    const c = toHex(base.map((v) => v + (255 - v) * f) as [number, number, number]);
    if (contrastRatio(c, '#101418') >= 4.5) return c;
  }
  return '#FFFFFF';
}

export function applyAccent(
  el: HTMLElement,
  accent: string,
  accentDark = deriveAccentDark(accent),
): void {
  el.style.setProperty('--rs-accent', accent);
  el.style.setProperty('--rs-accent-dark', accentDark);
}
