import { describe, expect, it } from 'vitest';
import {
  StepController,
  UPLOAD_STEPS,
  cameraLinkStruggling,
  uploadCongested,
} from './adaptation.js';

/** Feed one sample per second; return the changes that happened. */
function run(c: StepController, pattern: Array<[boolean, number]>, start = 0) {
  const changes: Array<{ at: number; direction: string; index: number }> = [];
  let t = start;
  for (const [bad, seconds] of pattern)
    for (let i = 0; i < seconds; i++, t += 1000) {
      const ch = c.update(bad, t);
      if (ch) changes.push({ at: t / 1000, ...ch });
    }
  return { changes, t };
}

describe('step controller (SPEC §11.5)', () => {
  it('ignores a short blip, and degrades after 5 s of sustained trouble', () => {
    const c = new StepController(5);
    expect(
      run(c, [
        [true, 4],
        [false, 10],
      ]).changes,
    ).toEqual([]);
    const { changes } = run(new StepController(5), [[true, 6]]);
    expect(changes).toEqual([{ at: 5, direction: 'down', index: 1 }]);
  });

  it('waits at least 20 s between changes, one step at a time', () => {
    const { changes } = run(new StepController(5), [[true, 60]]);
    expect(changes.map((c) => c.at)).toEqual([5, 25, 45]);
    expect(changes.at(-1)!.index).toBe(3);
  });

  it('stops at the last step', () => {
    const { changes } = run(new StepController(3), [[true, 200]]);
    expect(changes.map((c) => c.index)).toEqual([1, 2]);
  });

  it('upgrades only after 60 s of stability, one step at a time, never oscillating', () => {
    const c = new StepController(5);
    const down = run(c, [[true, 30]]); // two steps down
    expect(c.index).toBe(2);
    const up = run(c, [[false, 59]], down.t);
    expect(up.changes).toEqual([]);
    const up2 = run(c, [[false, 30]], up.t);
    expect(up2.changes).toEqual([{ at: up.t / 1000 + 1, direction: 'up', index: 1 }]);
    // A blip during recovery resets the stability clock.
    const blip = run(
      c,
      [
        [true, 2],
        [false, 59],
      ],
      up2.t,
    );
    expect(blip.changes).toEqual([]);
  });
});

describe('signals', () => {
  it('reads upload congestion from the browser, or from capacity below the ceiling', () => {
    const ceiling = UPLOAD_STEPS.full_hd[0]!;
    expect(
      uploadCongested(
        { qualityLimitation: 'bandwidth', availableOutgoingBps: null, sentBps: null },
        ceiling,
      ),
    ).toBe(true);
    expect(
      uploadCongested(
        { qualityLimitation: 'none', availableOutgoingBps: 5_000_000, sentBps: null },
        ceiling,
      ),
    ).toBe(true);
    expect(
      uploadCongested(
        { qualityLimitation: 'none', availableOutgoingBps: 9_000_000, sentBps: null },
        ceiling,
      ),
    ).toBe(false);
    expect(
      uploadCongested(
        { qualityLimitation: 'cpu', availableOutgoingBps: null, sentBps: null },
        ceiling,
      ),
    ).toBe(false);
  });

  it('blames the camera link for loss or freezes, but not dim light', () => {
    expect(
      cameraLinkStruggling({ receivedFps: 30, captureFps: 30, lossPct: 5, freezesDelta: 0 }),
    ).toBe(true);
    expect(
      cameraLinkStruggling({ receivedFps: 30, captureFps: 30, lossPct: 0, freezesDelta: 1 }),
    ).toBe(true);
    expect(
      cameraLinkStruggling({ receivedFps: 18, captureFps: 30, lossPct: 0, freezesDelta: 0 }),
    ).toBe(true);
    // The phone itself captures 15 fps in a dark room: lowering the bitrate would not help.
    expect(
      cameraLinkStruggling({ receivedFps: 15, captureFps: 15, lossPct: 0, freezesDelta: 0 }),
    ).toBe(false);
    expect(
      cameraLinkStruggling({
        receivedFps: null,
        captureFps: null,
        lossPct: null,
        freezesDelta: null,
      }),
    ).toBe(false);
  });
});
