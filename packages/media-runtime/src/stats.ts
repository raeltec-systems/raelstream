/** Helpers over RTCStatsReport-like data (B§24.1). Missing fields stay null, never 0. */

export type StatsLike = Map<string, Record<string, unknown>>;

export function toMap(report: RTCStatsReport | StatsLike): StatsLike {
  if (report instanceof Map) return report as StatsLike;
  const m: StatsLike = new Map();
  (report as RTCStatsReport).forEach((v: Record<string, unknown>) => m.set(v.id as string, v));
  return m;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Interval rate from two cumulative counters: 8·Δbytes/Δseconds (bits/s). */
export function rateBps(
  prevBytes: number | null,
  curBytes: number | null,
  dtMs: number,
): number | null {
  if (prevBytes === null || curBytes === null || dtMs <= 0 || curBytes < prevBytes) return null;
  return (8 * (curBytes - prevBytes)) / (dtMs / 1000);
}

/** Average jitter-buffer residence per emitted frame over the interval, in ms. */
export function jitterBufferMs(
  prevDelayS: number | null,
  curDelayS: number | null,
  prevCount: number | null,
  curCount: number | null,
): number | null {
  if (prevDelayS === null || curDelayS === null || prevCount === null || curCount === null)
    return null;
  const dc = curCount - prevCount;
  if (dc <= 0) return null;
  return ((curDelayS - prevDelayS) / dc) * 1000;
}

export type RouteLabel = 'direct_verified' | 'direct_unverified' | 'relayed' | 'unknown';

/**
 * Camera route classification (SPEC §8.4, NET-03). Only claims "verified" when both candidates are
 * host candidates AND the venue has a recorded WAN-block test.
 */
export function classifyRoute(report: StatsLike, wanBlockTestPassed: boolean): RouteLabel {
  let pair: Record<string, unknown> | undefined;
  for (const s of report.values()) {
    if (s.type === 'transport' && typeof s.selectedCandidatePairId === 'string') {
      pair = report.get(s.selectedCandidatePairId);
      break;
    }
  }
  if (!pair) {
    for (const s of report.values()) {
      if (
        s.type === 'candidate-pair' &&
        (s.selected === true || (s.nominated === true && s.state === 'succeeded'))
      ) {
        pair = s;
        break;
      }
    }
  }
  if (!pair) return 'unknown';
  const local = report.get(pair.localCandidateId as string);
  const remote = report.get(pair.remoteCandidateId as string);
  const lt = local?.candidateType;
  const rt = remote?.candidateType;
  if (lt === undefined || rt === undefined) return 'unknown';
  if (lt === 'relay' || rt === 'relay') return 'relayed';
  if (lt === 'host' && rt === 'host')
    return wanBlockTestPassed ? 'direct_verified' : 'direct_unverified';
  return 'unknown';
}

export interface InboundVideoSample {
  atMs: number;
  bytes: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  packetsLost: number | null;
  packetsReceived: number | null;
  jitterBufferDelay: number | null;
  jitterBufferEmittedCount: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  rttMs: number | null;
}

export function sampleInboundVideo(report: StatsLike, atMs: number): InboundVideoSample | null {
  let inbound: Record<string, unknown> | undefined;
  for (const s of report.values()) if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s;
  if (!inbound) return null;
  let rtt: number | null = null;
  for (const s of report.values()) {
    if (s.type === 'candidate-pair' && (s.nominated === true || s.selected === true)) {
      const r = num(s.currentRoundTripTime);
      if (r !== null) rtt = r * 1000;
    }
  }
  const codec = inbound.codecId ? report.get(inbound.codecId as string) : undefined;
  return {
    atMs,
    bytes: num(inbound.bytesReceived),
    framesDecoded: num(inbound.framesDecoded),
    framesDropped: num(inbound.framesDropped),
    packetsLost: num(inbound.packetsLost),
    packetsReceived: num(inbound.packetsReceived),
    jitterBufferDelay: num(inbound.jitterBufferDelay),
    jitterBufferEmittedCount: num(inbound.jitterBufferEmittedCount),
    width: num(inbound.frameWidth),
    height: num(inbound.frameHeight),
    codec: typeof codec?.mimeType === 'string' ? codec.mimeType : null,
    rttMs: rtt,
  };
}

export interface InboundVideoSummary {
  bitrateBps: number | null;
  fps: number | null;
  lossPct: number | null;
  jitterBufferMs: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  rttMs: number | null;
}

export function summarizeInbound(
  prev: InboundVideoSample | null,
  cur: InboundVideoSample,
): InboundVideoSummary {
  const dt = prev ? cur.atMs - prev.atMs : 0;
  let fps: number | null = null;
  let lossPct: number | null = null;
  if (prev && dt > 0 && prev.framesDecoded !== null && cur.framesDecoded !== null) {
    fps = ((cur.framesDecoded - prev.framesDecoded) * 1000) / dt;
  }
  if (
    prev &&
    prev.packetsLost !== null &&
    cur.packetsLost !== null &&
    prev.packetsReceived !== null &&
    cur.packetsReceived !== null
  ) {
    const lost = cur.packetsLost - prev.packetsLost;
    const recv = cur.packetsReceived - prev.packetsReceived;
    lossPct = lost + recv > 0 ? (100 * Math.max(0, lost)) / (lost + recv) : null;
  }
  return {
    bitrateBps: prev ? rateBps(prev.bytes, cur.bytes, dt) : null,
    fps,
    lossPct,
    jitterBufferMs: prev
      ? jitterBufferMs(
          prev.jitterBufferDelay,
          cur.jitterBufferDelay,
          prev.jitterBufferEmittedCount,
          cur.jitterBufferEmittedCount,
        )
      : null,
    width: cur.width,
    height: cur.height,
    codec: cur.codec,
    rttMs: cur.rttMs,
  };
}

export type LinkQuality = 'good' | 'reduced' | 'unstable' | 'disconnected';

/** Network quality label for the camera operator, from measured symptoms only (B§7.1, B§9.5). */
export function linkQuality(s: InboundVideoSummary | null, connected: boolean): LinkQuality {
  if (!connected || !s) return 'disconnected';
  if (s.fps !== null && s.fps < 15) return 'unstable';
  if (s.lossPct !== null && s.lossPct > 5) return 'unstable';
  if (
    (s.fps !== null && s.fps < 26) ||
    (s.lossPct !== null && s.lossPct > 1) ||
    (s.height !== null && s.height < 720)
  )
    return 'reduced';
  return 'good';
}
