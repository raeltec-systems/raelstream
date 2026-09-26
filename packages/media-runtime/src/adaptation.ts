/**
 * Quality adaptation (SPEC §11.5, B§14). Two independent controllers, each evaluated at 1 Hz:
 * the programme upload (studio → media node) and the camera link (phone → studio). Both use the same
 * step rules. Audio is never touched.
 */

export const DEGRADE_AFTER_MS = 5_000;
export const MIN_GAP_MS = 20_000;
export const UPGRADE_AFTER_MS = 60_000;

export type StepChange = { direction: 'down' | 'up'; index: number } | null;

/**
 * Moves along a list of steps (index 0 = best quality). Degrade after 5 s of sustained evidence,
 * at least 20 s between changes, upgrade one step after 60 s of stability.
 */
export class StepController {
  index = 0;
  private badSince: number | null = null;
  private goodSince: number | null = null;
  private lastChangeAt = Number.NEGATIVE_INFINITY;

  constructor(readonly steps: number) {}

  update(bad: boolean, now: number): StepChange {
    if (bad) {
      this.goodSince = null;
      this.badSince ??= now;
      if (
        this.index < this.steps - 1 &&
        now - this.badSince >= DEGRADE_AFTER_MS &&
        now - this.lastChangeAt >= MIN_GAP_MS
      ) {
        this.index++;
        this.lastChangeAt = now;
        this.badSince = now; // fresh evidence needed for the next step
        return { direction: 'down', index: this.index };
      }
      return null;
    }
    this.badSince = null;
    this.goodSince ??= now;
    if (
      this.index > 0 &&
      now - this.goodSince >= UPGRADE_AFTER_MS &&
      now - this.lastChangeAt >= MIN_GAP_MS
    ) {
      this.index--;
      this.lastChangeAt = now;
      this.goodSince = now;
      return { direction: 'up', index: this.index };
    }
    return null;
  }

  reset(): void {
    this.index = 0;
    this.badSince = null;
    this.goodSince = null;
    this.lastChangeAt = Number.NEGATIVE_INFINITY;
  }
}

/** Programme upload ceilings (SPEC §11.5). */
export const UPLOAD_STEPS: Record<'full_hd' | 'reliable_hd', number[]> = {
  full_hd: [8_000_000, 6_000_000, 4_500_000, 3_000_000, 1_500_000],
  reliable_hd: [4_500_000, 3_000_000, 2_000_000, 1_500_000],
};

/** CPU relief for the laptop's encoder: full, then 1.5× smaller, then also 15 fps. */
export const CPU_STEPS = [
  { scaleResolutionDownBy: 1, maxFramerate: 30 },
  { scaleResolutionDownBy: 1.5, maxFramerate: 30 },
  { scaleResolutionDownBy: 1.5, maxFramerate: 15 },
] as const;

/** Camera link bitrates sent to the phone (SPEC §11.5). */
export const CAMERA_STEPS = [8_000_000, 5_000_000, 3_000_000, 2_000_000];

export interface UploadSignals {
  qualityLimitation: string | null;
  availableOutgoingBps: number | null;
  sentBps: number | null;
}

/** Bandwidth trouble: the browser says so, or the estimated capacity is below the current ceiling. */
export function uploadCongested(s: UploadSignals, ceilingBps: number): boolean {
  if (s.qualityLimitation === 'bandwidth') return true;
  return s.availableOutgoingBps !== null && s.availableOutgoingBps < ceilingBps * 0.9;
}

export interface CameraSignals {
  receivedFps: number | null;
  /** What the phone says it captures; low light lowers it and a bitrate change would not help. */
  captureFps: number | null;
  lossPct: number | null;
  freezesDelta: number | null;
}

/** The link, not the camera, is the problem: frames or packets are lost on the way. */
export function cameraLinkStruggling(s: CameraSignals): boolean {
  if (s.lossPct !== null && s.lossPct > 2) return true;
  if (s.freezesDelta !== null && s.freezesDelta > 0) return true;
  if (s.receivedFps !== null && s.captureFps !== null && s.captureFps >= 24)
    return s.receivedFps < s.captureFps * 0.8;
  return false;
}
