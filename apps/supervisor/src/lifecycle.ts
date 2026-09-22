import type { DesiredState, ObservedState } from '@raelstream/contracts';

/**
 * Session lifecycle derived from observed media (SPEC §18). Only called while live and not stopping.
 * STARTING until the first destination is sending; RECOVERING while the fallback slate is on air.
 */
export function deriveLiveLifecycle(
  desired: DesiredState,
  observed: ObservedState,
  current: string,
): string {
  if (current === 'STOPPING' || current === 'ENDED' || current === 'INTERRUPTED') return current;
  if (observed.fallback.active) return 'RECOVERING';
  const wanted = Object.entries(desired.publishers)
    .filter(([, p]) => p.state === 'running')
    .map(([id]) => id);
  if (wanted.length === 0) return current;
  const sending = wanted.filter((id) => {
    const s = observed.destinations[id]?.state;
    return s === 'SENDING' || s === 'LIVE_CONFIRMED';
  });
  if (sending.length === wanted.length) return 'SENDING';
  if (sending.length > 0) return 'PARTIAL';
  return current === 'SENDING' || current === 'PARTIAL' || current === 'RECOVERING'
    ? 'PARTIAL'
    : 'STARTING';
}

export function emptyObserved(generation: number, now: string): ObservedState {
  return {
    generation,
    updatedAt: now,
    contribution: { state: 'absent', since: now, tracks: [] },
    normaliser: { state: 'stopped', since: now, speed: null, fps: null },
    fallback: { active: false, since: null, graceEndsAt: null },
    destinations: {},
  };
}
