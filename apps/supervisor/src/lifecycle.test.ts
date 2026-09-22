import { describe, expect, it } from 'vitest';
import type { DesiredState } from '@raelstream/contracts';
import { deriveLiveLifecycle, emptyObserved } from './lifecycle.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const desired: DesiredState = {
  generation: 1,
  mode: 'live',
  profile: 'reliable_hd',
  normaliser: 'running',
  fallbackGraceS: 120,
  stopRequestedAt: null,
  endOnStop: true,
  publishers: {
    [A]: { state: 'running', retryNonce: 0 },
    [B]: { state: 'running', retryNonce: 0 },
  },
};
function obs(a: string, b: string, fallback = false) {
  const o = emptyObserved(1, 'now');
  const d = (state: string) => ({
    state: state as never,
    since: 'now',
    attempts: 0,
    failure: null,
    bitrateKbps: null,
    sendingSince: null,
  });
  o.destinations = { [A]: d(a), [B]: d(b) };
  o.fallback.active = fallback;
  return o;
}

describe('deriveLiveLifecycle', () => {
  it('stays STARTING until a destination is sending', () => {
    expect(deriveLiveLifecycle(desired, obs('CONNECTING', 'CONNECTING'), 'STARTING')).toBe(
      'STARTING',
    );
  });
  it('is SENDING when all are sending and PARTIAL when one fails (A28)', () => {
    expect(deriveLiveLifecycle(desired, obs('SENDING', 'SENDING'), 'STARTING')).toBe('SENDING');
    expect(deriveLiveLifecycle(desired, obs('SENDING', 'FAILED'), 'SENDING')).toBe('PARTIAL');
    expect(deriveLiveLifecycle(desired, obs('RECONNECTING', 'FAILED'), 'SENDING')).toBe('PARTIAL');
  });
  it('is RECOVERING while the fallback slate is on air', () => {
    expect(deriveLiveLifecycle(desired, obs('SENDING', 'SENDING', true), 'SENDING')).toBe(
      'RECOVERING',
    );
  });
  it('never overrides stopping or ended', () => {
    expect(deriveLiveLifecycle(desired, obs('SENDING', 'SENDING'), 'STOPPING')).toBe('STOPPING');
    expect(deriveLiveLifecycle(desired, obs('SENDING', 'SENDING'), 'ENDED')).toBe('ENDED');
  });
});
