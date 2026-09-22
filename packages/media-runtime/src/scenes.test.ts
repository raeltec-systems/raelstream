import { describe, expect, it } from 'vitest';
import { fitRect, shortenForAir } from './scenes.js';

describe('fitRect', () => {
  it('pillarboxes a portrait frame in contain mode (A13)', () => {
    const r = fitRect(1080, 1920, 1920, 1080, 'contain');
    expect(r.h).toBe(1080);
    expect(r.w).toBeCloseTo(607.5);
    expect(r.x).toBeCloseTo(656.25);
  });
  it('crops in fill mode', () => {
    const r = fitRect(1080, 1920, 1920, 1080, 'fill');
    expect(r.w).toBe(1920);
    expect(r.y).toBeLessThan(0);
  });
});

describe('shortenForAir', () => {
  it('keeps short lines and shortens long ones to 40 chars', () => {
    expect(shortenForAir('Pastor Mwansa Banda')).toBe('Pastor Mwansa Banda');
    const long = 'A very long lower third line that will not fit on air';
    expect(shortenForAir(long).length).toBeLessThanOrEqual(40);
    expect(shortenForAir(long).endsWith('…')).toBe(true);
  });
});
