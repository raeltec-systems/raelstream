import { Observable } from './emitter.js';
import { preferCodecs, waitForIceGathering } from './sdp.js';
import { rateBps, toMap } from './stats.js';

export type WhipStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';
export type WhipErrorCode =
  'INGEST_AUTH' | 'INGEST_MEDIA_UNSUPPORTED' | 'INGEST_TIMEOUT' | 'STALE_GENERATION' | null;

export interface WhipState {
  status: WhipStatus;
  error: WhipErrorCode;
  bitrateBps: number | null;
  rttMs: number | null;
  qualityLimitation: string | null;
  framesPerSecond: number | null;
  /** The browser's estimate of upload capacity on the selected path. */
  availableOutgoingBps: number | null;
  route: 'udp' | 'tcp' | 'relay' | 'unknown';
}

export interface VideoEncoding {
  maxBitrate: number;
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

export interface WhipTarget {
  whipUrl: string;
  bearer: string;
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
}

/**
 * Programme contribution over WHIP (RFC 9725, SPEC §11.1). One video + one audio track, one resource per
 * generation. The resource is DELETEd on stop. Creation errors are classified, not retried blindly.
 */
export class WhipPublisher extends Observable<WhipState> {
  private pc: RTCPeerConnection | null = null;
  private resource: string | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private prevBytes: number | null = null;
  private prevFrames: number | null = null;
  private prevAt = 0;
  private epoch = 0;
  private request: AbortController | null = null;

  constructor(
    private readonly videoTrack: MediaStreamTrack,
    private readonly audioTrack: MediaStreamTrack,
    private readonly maxVideoBps: number,
  ) {
    super({
      status: 'idle',
      error: null,
      bitrateBps: null,
      rttMs: null,
      qualityLimitation: null,
      framesPerSecond: null,
      availableOutgoingBps: null,
      route: 'unknown',
    });
  }

  /** Adaptation (SPEC §11.5): change the programme encoding in place; the track is never replaced. */
  async setEncoding(e: VideoEncoding): Promise<void> {
    const sender = this.pc?.getSenders().find((x) => x.track?.kind === 'video');
    if (!sender) return;
    const p = sender.getParameters();
    p.encodings = [
      {
        ...(p.encodings?.[0] ?? {}),
        maxBitrate: Math.min(e.maxBitrate, this.maxVideoBps),
        scaleResolutionDownBy: e.scaleResolutionDownBy,
        maxFramerate: e.maxFramerate,
      },
    ];
    await sender.setParameters(p).catch(() => undefined);
  }

  async start(target: WhipTarget): Promise<void> {
    const cleanup = this.stop();
    const epoch = this.epoch;
    await cleanup;
    if (epoch !== this.epoch) return;
    this.set({ status: 'connecting', error: null });
    const pc = new RTCPeerConnection({
      iceServers: target.iceServers,
      iceTransportPolicy: target.iceTransportPolicy ?? 'all',
      bundlePolicy: 'max-bundle',
    });
    this.pc = pc;
    const stream = new MediaStream([this.videoTrack, this.audioTrack]);
    const v = pc.addTransceiver(this.videoTrack, { direction: 'sendonly', streams: [stream] });
    const a = pc.addTransceiver(this.audioTrack, { direction: 'sendonly', streams: [stream] });
    preferCodecs(v, 'video', ['video/H264', 'video/VP8']);
    preferCodecs(a, 'audio', ['audio/opus']);
    const params = v.sender.getParameters();
    params.encodings = [
      { ...(params.encodings?.[0] ?? {}), maxBitrate: this.maxVideoBps, maxFramerate: 30 },
    ];
    params.degradationPreference = 'maintain-framerate';
    await v.sender.setParameters(params).catch(() => undefined);

    pc.addEventListener('connectionstatechange', () => {
      if (this.pc !== pc || epoch !== this.epoch) return;
      const s = pc.connectionState;
      if (s === 'connected') this.set({ status: 'connected' });
      else if (s === 'disconnected') this.set({ status: 'reconnecting' });
      else if (s === 'failed') this.set({ status: 'failed', error: 'INGEST_TIMEOUT' });
    });

    const offer = await pc.createOffer();
    // Stereo Opus for mixer audio (SPEC §11.1).
    offer.sdp = offer.sdp?.replace(
      /(a=fmtp:\d+ .*minptime=\d+;useinbandfec=1)/g,
      '$1;stereo=1;sprop-stereo=1;maxaveragebitrate=192000',
    );
    await pc.setLocalDescription(offer);
    // Relay candidates (TURN over TCP/TLS) take longer to gather than host ones.
    await waitForIceGathering(pc, target.iceServers.length > 0 ? 6000 : 2000);
    if (epoch !== this.epoch) return;

    const ctrl = new AbortController();
    this.request = ctrl;
    const timeout = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(target.whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${target.bearer}` },
        body: pc.localDescription!.sdp,
        signal: ctrl.signal,
      });
    } catch {
      if (epoch === this.epoch) this.fail('INGEST_TIMEOUT');
      return;
    } finally {
      clearTimeout(timeout);
      if (this.request === ctrl) this.request = null;
    }
    if (epoch !== this.epoch) return;
    if (res.status === 401 || res.status === 403) return this.fail('INGEST_AUTH');
    if (res.status === 409) return this.fail('STALE_GENERATION');
    if (res.status === 400 || res.status === 415 || res.status === 406)
      return this.fail('INGEST_MEDIA_UNSUPPORTED');
    if (res.status !== 201) return this.fail('INGEST_TIMEOUT');
    const loc = res.headers.get('Location');
    this.resource = loc ? new URL(loc, target.whipUrl).toString() : null;
    this.bearer = target.bearer;
    const sdp = await res.text();
    if (epoch !== this.epoch) return;
    await pc.setRemoteDescription({ type: 'answer', sdp });
    if (epoch !== this.epoch) return;
    this.statsTimer = setInterval(() => void this.pollStats(), 1000);
  }

  private bearer = '';

  /** Idempotent stop; DELETE the WHIP resource (best effort, 2 s). */
  async stop(): Promise<void> {
    ++this.epoch;
    this.request?.abort();
    this.request = null;
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    const res = this.resource;
    this.resource = null;
    this.pc?.close();
    this.pc = null;
    this.prevBytes = null;
    this.prevFrames = null;
    this.prevAt = 0;
    if (this.state.status !== 'idle') this.set({ status: 'closed', bitrateBps: null });
    if (res) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      await fetch(res, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.bearer}` },
        signal: ctrl.signal,
      }).catch(() => undefined);
      clearTimeout(timer);
    }
  }

  private fail(code: Exclude<WhipErrorCode, null>): void {
    this.pc?.close();
    this.pc = null;
    this.set({ status: 'failed', error: code });
  }

  private async pollStats(): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    const stats = await pc.getStats().catch(() => null);
    if (!stats || this.pc !== pc) return;
    const r = toMap(stats);
    const now = performance.now();
    let bytes: number | null = null;
    let frames: number | null = null;
    let ql: string | null = null;
    let rtt: number | null = null;
    let route: WhipState['route'] = 'unknown';
    let available: number | null = null;
    for (const s of r.values()) {
      if (s.type === 'outbound-rtp' && s.kind === 'video') {
        bytes = typeof s.bytesSent === 'number' ? s.bytesSent : null;
        frames = typeof s.framesEncoded === 'number' ? s.framesEncoded : null;
        ql = typeof s.qualityLimitationReason === 'string' ? s.qualityLimitationReason : null;
      }
      if (s.type === 'transport' && typeof s.selectedCandidatePairId === 'string') {
        const pair = r.get(s.selectedCandidatePairId);
        if (typeof pair?.currentRoundTripTime === 'number') rtt = pair.currentRoundTripTime * 1000;
        if (typeof pair?.availableOutgoingBitrate === 'number')
          available = pair.availableOutgoingBitrate;
        const local = pair ? r.get(pair.localCandidateId as string) : undefined;
        if (local?.candidateType === 'relay') route = 'relay';
        else if (local?.protocol === 'udp') route = 'udp';
        else if (local?.protocol === 'tcp') route = 'tcp';
      }
    }
    const dt = now - this.prevAt;
    const fps =
      this.prevFrames !== null && frames !== null && dt > 0
        ? ((frames - this.prevFrames) * 1000) / dt
        : null;
    this.set({
      bitrateBps: rateBps(this.prevBytes, bytes, dt),
      framesPerSecond: fps,
      qualityLimitation: ql,
      rttMs: rtt,
      availableOutgoingBps: available,
      route,
    });
    this.prevBytes = bytes;
    this.prevFrames = frames;
    this.prevAt = now;
  }
}
