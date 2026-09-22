import { describe, expect, it } from 'vitest';
import { contrastRatio, deriveAccentDark } from './accent.js';

describe('accent theming', () => {
  it('matches the design Sky pair contrast for button text', () => {
    expect(contrastRatio('#2F6FCF', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#6EA2F0', '#101418')).toBeGreaterThanOrEqual(4.5);
  });
  it('derives a dark-mode accent with ≥4.5:1 against near-black text', () => {
    for (const c of ['#2F6FCF', '#C0613A', '#1F7A86', '#2B4C7E', '#000000']) {
      expect(contrastRatio(deriveAccentDark(c), '#101418')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
