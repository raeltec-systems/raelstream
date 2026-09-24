import { describe, expect, it } from 'vitest';
import {
  LOWER_THIRD_IN_MS,
  LOWER_THIRD_OUT_MS,
  TEXT_MAX_LINES,
  TEXT_MIN_PX,
  layoutTextCard,
  lowerThirdMotion,
  wrapText,
} from './overlays.js';

/** A canvas stand-in whose glyphs are half as wide as the font size. */
function fakeCtx() {
  const g = {
    font: '400 10px x',
    measureText(s: string) {
      const px = Number(/(\d+)px/.exec(g.font)![1]);
      return { width: s.length * px * 0.5 } as TextMetrics;
    },
  };
  return g as unknown as CanvasRenderingContext2D;
}

describe('text card layout (SPEC §10.3)', () => {
  it('wraps on words, keeps paragraphs, and splits a word longer than the line', () => {
    const g = fakeCtx();
    g.font = '400 10px x'; // 5 px per character
    expect(wrapText(g, 'the lord is my shepherd', 60)).toEqual(['the lord is', 'my shepherd']);
    expect(wrapText(g, 'a\n\nb', 60)).toEqual(['a', '', 'b']);
    expect(wrapText(g, 'abcdefghijklmnopqrstuvwxyz', 50)).toEqual([
      'abcdefghij',
      'klmnopqrst',
      'uvwxyz',
    ]);
  });

  it('keeps a short announcement at full size', () => {
    const l = layoutTextCard(
      fakeCtx(),
      { title: 'Welcome', detail: 'Tea after the service.' },
      'x',
    );
    expect(l).toMatchObject({ bodyPx: 64, fits: true });
  });

  it('shrinks a long passage, and refuses one that does not fit at the smallest size', () => {
    const psalm = 'The Lord is my shepherd; I shall not want. '.repeat(10).trim();
    const l = layoutTextCard(
      fakeCtx(),
      { title: 'Psalm 23', detail: psalm, reference: 'Psalm 23:1' },
      'x',
    );
    expect(l.fits).toBe(true);
    expect(l.bodyPx).toBeLessThan(64);
    expect(l.lines.length).toBeLessThanOrEqual(TEXT_MAX_LINES);
    const tooLong = layoutTextCard(fakeCtx(), { title: 'x', detail: 'word '.repeat(600) }, 'x');
    expect(tooLong).toMatchObject({ fits: false, bodyPx: TEXT_MIN_PX });
  });
});

describe('lowerThirdMotion', () => {
  it('slides in from the left and settles in place', () => {
    const start = lowerThirdMotion(0);
    expect(start.alpha).toBe(0);
    expect(start.dx).toBeLessThan(0);
    const mid = lowerThirdMotion(LOWER_THIRD_IN_MS / 2);
    expect(mid.alpha).toBeGreaterThan(0.5); // ease-out: most of the way there by half time
    expect(lowerThirdMotion(LOWER_THIRD_IN_MS)).toEqual({ alpha: 1, dx: -0 });
    expect(lowerThirdMotion(10_000)).toEqual({ alpha: 1, dx: -0 });
  });

  it('fades out in place', () => {
    expect(lowerThirdMotion(0, true)).toEqual({ alpha: 1, dx: 0 });
    expect(lowerThirdMotion(LOWER_THIRD_OUT_MS, true).alpha).toBe(0);
  });
});
