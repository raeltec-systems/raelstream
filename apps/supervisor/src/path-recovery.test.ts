import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesiredState } from '@raelstream/contracts';
import type { SupervisorConfig } from './config.js';
import type { SupervisorDB } from './db.js';
import type { Kysely } from 'kysely';
import { Supervisor } from './supervisor.js';

vi.mock('./slate.js', () => ({ ensureSlate: async () => '/slates/slate.mp4' }));
const want: DesiredState = {
  generation: 1,
  mode: 'live',
  profile: 'reliable_hd',
  normaliser: 'running',
  publishers: {},
  fallbackGraceS: 60,
  stopRequestedAt: null,
  endOnStop: true,
  record: true,
};
function setup() {
  const sup = new Supervisor({} as SupervisorConfig, {} as Kysely<SupervisorDB>, vi.fn());
  const media = {
    hasPathConfig: vi.fn(async () => true),
    upsertPathConfig: vi.fn(async (_name: string, _config: Record<string, unknown>) => {}),
  };
  Object.assign(sup, { mtx: media });
  const target = sup as unknown as {
    ensureNormPath: (id: string, name: string, d: DesiredState) => Promise<void>;
    normCheckAt: number;
  };
  return {
    media,
    ensure: () => {
      target.normCheckAt = 0;
      return target.ensureNormPath('session', 'Sunday', want);
    },
  };
}
beforeEach(() => vi.clearAllMocks());
describe('MediaMTX output configuration recovery', () => {
  it('recreates the same output path with fallback and recording after media server restart', async () => {
    const { media, ensure } = setup();
    await ensure();
    const path = media.upsertPathConfig.mock.calls[0]![0];
    media.hasPathConfig.mockResolvedValue(false);
    await ensure();
    expect(media.upsertPathConfig).toHaveBeenLastCalledWith(
      path,
      expect.objectContaining({
        alwaysAvailable: true,
        alwaysAvailableFile: '/slates/slate.mp4',
        record: true,
      }),
    );
    expect(media.upsertPathConfig).toHaveBeenCalledTimes(2);
  });
  it('does not replace healthy path configuration on every reconciliation', async () => {
    const { media, ensure } = setup();
    await ensure();
    await ensure();
    expect(media.hasPathConfig).toHaveBeenCalledTimes(1);
    expect(media.upsertPathConfig).toHaveBeenCalledTimes(1);
  });
  it('retains the path across an API outage and retries restoration afterwards', async () => {
    const { media, ensure } = setup();
    await ensure();
    media.hasPathConfig.mockRejectedValueOnce(new Error('offline'));
    await expect(ensure()).rejects.toThrow('offline');
    media.hasPathConfig.mockResolvedValue(false);
    await ensure();
    expect(media.upsertPathConfig).toHaveBeenCalledTimes(2);
    expect(media.upsertPathConfig.mock.calls[0]![0]).toBe(media.upsertPathConfig.mock.calls[1]![0]);
  });
});
