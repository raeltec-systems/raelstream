import { describe, expect, it } from 'vitest';
import {
  SilenceDetector,
  detectOnset,
  suggestDelay,
  availableModes,
  clampDelayMs,
  meterPosition,
  routingGains,
  toDbfs,
} from './audio-math.js';

describe('routingGains', () => {
  it('sends input 1 to both ears by default (A15)', () => {
    expect(routingGains('in1_both')).toEqual([1, 0, 1, 0]);
  });
  it('keeps stereo channels separate', () => {
    expect(routingGains('stereo_12')).toEqual([1, 0, 0, 1]);
  });
  it('normalises mono blend to (L+R)/2 so correlated signals keep their level', () => {
    const [l1, l2] = routingGains('mono_blend');
    expect(l1 + l2).toBe(1);
  });
  it('disables stereo modes when the browser gives one channel', () => {
    expect(availableModes(1)).toEqual(['in1_both']);
    expect(availableModes(2)).toHaveLength(4);
  });
});

describe('clampDelayMs (SYNC-01)', () => {
  it.each([
    [0, 0],
    [5, 10],
    [4, 0],
    [123, 120],
    [2000, 2000],
    [2500, 2000],
    [-50, 0],
    [Number.NaN, 0],
    [Infinity, 0],
  ])('%s → %s', (input, out) => expect(clampDelayMs(input)).toBe(out));
});

describe('levels', () => {
  it('converts amplitude to dBFS', () => {
    expect(toDbfs(1)).toBe(0);
    expect(toDbfs(0.5)).toBeCloseTo(-6.02, 1);
    expect(toDbfs(0)).toBe(-90);
  });
  it('maps −60..0 dB to the meter', () => {
    expect(meterPosition(-60)).toBe(0);
    expect(meterPosition(0)).toBe(1);
    expect(meterPosition(-6)).toBeCloseTo(0.9);
  });
});

describe('SilenceDetector', () => {
  it('warns only after 15 s below −60 dBFS and resets on sound', () => {
    const d = new SilenceDetector();
    expect(d.update(-80, 0)).toBe(false);
    expect(d.update(-80, 14_999)).toBe(false);
    expect(d.update(-80, 15_000)).toBe(true);
    expect(d.update(-20, 15_500)).toBe(false);
    expect(d.update(-80, 16_000)).toBe(false);
  });
});

describe('sync tool maths (SPEC §11.4)', () => {
  const rate = 48000;
  const clip = (clapAtS: number, noiseDb = -60) => {
    const x = new Float32Array(rate * 2);
    const n = 10 ** (noiseDb / 20);
    for (let i = 0; i < x.length; i++) x[i] = (i % 2 ? 1 : -1) * n;
    const at = Math.round(clapAtS * rate);
    for (let i = at; i < at + 480; i++) x[i] = 0.8 * Math.exp(-(i - at) / 100);
    return x;
  };

  it('finds the clap after quiet, to within a millisecond', () => {
    expect(detectOnset(clip(1.234), rate)! - 1.234).toBeCloseTo(0, 3);
  });
  it('ignores a loud start with no quiet before it, and finds nothing in silence', () => {
    const loud = clip(0.0, -10);
    expect(detectOnset(loud, rate)).toBeNull();
    expect(detectOnset(new Float32Array(rate), rate)).toBeNull();
  });
  it('turns the marked frame and the clap into a delay', () => {
    // Sound 120 ms before the picture with no delay: add 120 ms.
    expect(suggestDelay(0, 1.0, 0.88)).toEqual({
      measuredOffsetMs: -120,
      suggestedMs: 120,
      result: 'ok',
    });
    // Already delayed 200 ms and now 40 ms late: back off to 160.
    expect(suggestDelay(200, 1.0, 1.04)).toMatchObject({ suggestedMs: 160, result: 'ok' });
    // Sound 150 ms after the picture even at 0 ms: cannot be fixed with a delay.
    expect(suggestDelay(0, 1.0, 1.15)).toMatchObject({ result: 'audio_late' });
    // Within one frame late at 0 ms: fine, stay at 0.
    expect(suggestDelay(0, 1.0, 1.03)).toMatchObject({ suggestedMs: 0, result: 'ok' });
  });
});
