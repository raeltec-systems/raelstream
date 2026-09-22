export type RoutingMode = 'in1_both' | 'in2_both' | 'stereo_12' | 'mono_blend';
export const ROUTING_MODES: RoutingMode[] = ['in1_both', 'in2_both', 'stereo_12', 'mono_blend'];

/**
 * Gain matrix for channel routing (SPEC §10.4 step 4, B§12.2).
 * `[outL_from_in1, outL_from_in2, outR_from_in1, outR_from_in2]`.
 * Mono blend uses (L+R)/2 so a correlated signal keeps its level.
 */
export function routingGains(mode: RoutingMode): [number, number, number, number] {
  switch (mode) {
    case 'in1_both':
      return [1, 0, 1, 0];
    case 'in2_both':
      return [0, 1, 0, 1];
    case 'stereo_12':
      return [1, 0, 0, 1];
    case 'mono_blend':
      return [0.5, 0.5, 0.5, 0.5];
  }
}

/** Modes usable given the channel count the browser actually delivers (B§12.2). */
export function availableModes(channelCount: number): RoutingMode[] {
  return channelCount >= 2 ? ROUTING_MODES : ['in1_both'];
}

export const DELAY_MAX_MS = 2000;
export const DELAY_STEP_MS = 10;

/** SYNC-01: 0–2000 ms in 10 ms steps; invalid input clamps, NaN becomes 0. */
export function clampDelayMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const stepped = Math.round(value / DELAY_STEP_MS) * DELAY_STEP_MS;
  return Math.min(DELAY_MAX_MS, Math.max(0, stepped));
}

export function gainDbToLinear(db: number): number {
  return 10 ** (db / 20);
}

/** Peak amplitude (0..1) → dBFS, floored at −90. */
export function toDbfs(amplitude: number): number {
  if (amplitude <= 0) return -90;
  return Math.max(-90, 20 * Math.log10(amplitude));
}

/** Map dBFS to a 0..1 meter position on a −60..0 dB scale. */
export function meterPosition(dbfs: number): number {
  return Math.max(0, Math.min(1, (dbfs + 60) / 60));
}

/** Silence detector (SPEC §10.4 step 6): RMS below −60 dBFS for 15 s while unmuted. */
export class SilenceDetector {
  private quietSince: number | null = null;
  constructor(
    private readonly thresholdDb = -60,
    private readonly holdMs = 15_000,
  ) {}
  /** Returns true while the input has been silent longer than the hold period. */
  update(rmsDb: number, nowMs: number): boolean {
    if (rmsDb >= this.thresholdDb) {
      this.quietSince = null;
      return false;
    }
    this.quietSince ??= nowMs;
    return nowMs - this.quietSince >= this.holdMs;
  }
  reset(): void {
    this.quietSince = null;
  }
}
