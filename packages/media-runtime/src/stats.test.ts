import { describe, expect, it } from 'vitest';
import {
  classifyRoute,
  jitterBufferMs,
  linkQuality,
  rateBps,
  summarizeInbound,
  type InboundVideoSample,
  type StatsLike,
} from './stats.js';

function report(local: string, remote: string): StatsLike {
  return new Map<string, Record<string, unknown>>([
    ['T', { id: 'T', type: 'transport', selectedCandidatePairId: 'P' }],
    ['P', { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' }],
    ['L', { id: 'L', type: 'local-candidate', candidateType: local }],
    ['R', { id: 'R', type: 'remote-candidate', candidateType: remote }],
  ]);
}

describe('classifyRoute (NET-03)', () => {
  it('never claims verified without a WAN-block test', () => {
    expect(classifyRoute(report('host', 'host'), false)).toBe('direct_unverified');
    expect(classifyRoute(report('host', 'host'), true)).toBe('direct_verified');
  });
  it('reports relays and unknowns honestly', () => {
    expect(classifyRoute(report('relay', 'host'), true)).toBe('relayed');
    expect(classifyRoute(report('srflx', 'host'), true)).toBe('unknown');
    expect(classifyRoute(new Map(), true)).toBe('unknown');
  });
});

describe('counter deltas (B§24.1)', () => {
  it('computes interval bitrate', () => {
    expect(rateBps(1000, 126_000, 1000)).toBe(1_000_000);
    expect(rateBps(null, 5, 1000)).toBeNull();
    expect(rateBps(500, 100, 1000)).toBeNull();
  });
  it('computes jitter buffer residence per frame', () => {
    expect(jitterBufferMs(1, 1.9, 100, 130)).toBeCloseTo(30);
    expect(jitterBufferMs(1, 1.9, 100, 100)).toBeNull();
  });
});

const base: InboundVideoSample = {
  atMs: 0,
  bytes: 0,
  framesDecoded: 0,
  framesDropped: 0,
  packetsLost: 0,
  packetsReceived: 0,
  jitterBufferDelay: 0,
  jitterBufferEmittedCount: 0,
  width: 1920,
  height: 1080,
  codec: 'video/H264',
  rttMs: 4,
};

describe('summarizeInbound + linkQuality', () => {
  it('keeps missing telemetry as null, not healthy zeros', () => {
    const s = summarizeInbound(null, base);
    expect(s.fps).toBeNull();
    expect(s.bitrateBps).toBeNull();
  });
  it('labels a healthy 30 fps 1080p link good and a 12 fps one unstable', () => {
    const cur = { ...base, atMs: 1000, framesDecoded: 30, packetsReceived: 1000, bytes: 1_000_000 };
    expect(linkQuality(summarizeInbound(base, cur), true)).toBe('good');
    expect(linkQuality(summarizeInbound(base, { ...cur, framesDecoded: 12 }), true)).toBe(
      'unstable',
    );
    expect(linkQuality(summarizeInbound(base, cur), false)).toBe('disconnected');
  });
});
