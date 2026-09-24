import type { CtlEnvelope, CtlMessage, SignalPayload, TallyState } from '@raelstream/contracts';
import { CtlEnvelope as CtlEnvelopeSchema } from '@raelstream/contracts';
import { Observable } from './emitter.js';
import { opusForProgramme } from './sdp.js';
import {
  type InboundVideoSample,
  type InboundVideoSummary,
  type LinkQuality,
  type RouteLabel,
  classifyRoute,
  linkQuality,
  sampleInboundVideo,
  summarizeInbound,
  toMap,
} from './stats.js';

export interface CameraReceiverState {
  connection: RTCPeerConnectionState | 'idle';
  route: RouteLabel;
  summary: InboundVideoSummary | null;
  quality: LinkQuality;
  camState: Extract<CtlMessage, { t: 'cam.state' }> | null;
  tally: TallyState;
  /** ICE did not connect within the deadline: show the direct-link failure panel (SPEC §8.5). */
  directLinkFailed: boolean;
  /** The phone's audio slot (silent unless the operator chose the phone as the sound source). */
  audioStream: MediaStream | null;
}

export const DIRECT_CONNECT_DEADLINE_MS = 15_000;

/**
 * Studio side of the direct phone link. No ICE servers at all (NET-02): host candidates only, so the
 * camera path can never silently cross the internet.
 */
export class CameraReceiver extends Observable<CameraReceiverState> {
  readonly video: HTMLVideoElement;
  private pc: RTCPeerConnection | null = null;
  private ctl: RTCDataChannel | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private prev: InboundVideoSample | null = null;
  private seq = 0;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private audioWanted = false;
  /** Chrome feeds a remote WebRTC track to Web Audio only while a media element plays it (muted). */
  private readonly audioSink: HTMLAudioElement;

  constructor(
    private readonly sendSignal: (payload: SignalPayload) => void,
    private readonly generation: () => number,
    private readonly wanBlockTestPassed: () => boolean,
  ) {
    super({
      connection: 'idle',
      route: 'unknown',
      summary: null,
      quality: 'disconnected',
      camState: null,
      tally: 'off',
      directLinkFailed: false,
      audioStream: null,
    });
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    // Detached media elements are paused by the browser, so the source video lives in the document,
    // visually hidden. Previews use their own <video> on the same stream (no second decode).
    Object.assign(this.video.style, {
      position: 'fixed',
      width: '2px',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none',
      left: '0',
      top: '0',
    });
    this.video.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.video);
    this.audioSink = document.createElement('audio');
    this.audioSink.muted = true;
    this.audioSink.autoplay = true;
  }

  get stream(): MediaStream | null {
    return (this.video.srcObject as MediaStream | null) ?? null;
  }

  /** Handle a signalling message relayed from the phone. */
  async onSignal(p: SignalPayload): Promise<void> {
    if (p.type === 'offer') {
      this.reset();
      const pc = new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });
      this.pc = pc;
      pc.addEventListener('icecandidate', (e) =>
        this.sendSignal({
          type: 'candidate',
          candidate: e.candidate ? (e.candidate.toJSON() as { candidate: string }) : null,
        }),
      );
      pc.addEventListener('track', (e) => {
        if (e.track.kind === 'audio') {
          // Silent unless the operator picks the phone as the sound source (SPEC §8.8 decision).
          const audioStream = new MediaStream([e.track]);
          this.audioSink.srcObject = audioStream;
          void this.audioSink.play().catch(() => undefined);
          this.set({ audioStream });
          return;
        }
        if (e.track.kind !== 'video') return;
        this.video.srcObject = new MediaStream([e.track]);
        void this.video.play().catch(() => undefined);
        this.set({});
      });
      pc.addEventListener('datachannel', (e) => {
        if (e.channel.label !== 'ctl') return;
        this.ctl = e.channel;
        e.channel.onmessage = (m) => this.onCtl(m.data);
        e.channel.onopen = () => {
          this.sendCtl({ t: 'tally', state: this.state.tally });
          // After a reconnect the same phone resumes the sound the operator chose; never a substitute.
          if (this.audioWanted) this.sendCtl({ t: 'cam.setAudio', on: true });
        };
      });
      pc.addEventListener('connectionstatechange', () => {
        this.set({ connection: pc.connectionState });
        if (pc.connectionState === 'connected') {
          this.clearDeadline();
          this.set({ directLinkFailed: false });
        }
        if (pc.connectionState === 'failed') this.set({ directLinkFailed: true });
      });
      await pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
      for (const c of this.pendingCandidates.splice(0))
        await pc.addIceCandidate(c).catch(() => undefined);
      const created = await pc.createAnswer();
      const answer = { type: 'answer' as const, sdp: opusForProgramme(created.sdp ?? '') };
      await pc.setLocalDescription(answer);
      this.sendSignal({ type: 'answer', sdp: answer.sdp });
      this.deadline = setTimeout(() => {
        if (this.pc?.connectionState !== 'connected') this.set({ directLinkFailed: true });
      }, DIRECT_CONNECT_DEADLINE_MS);
      this.statsTimer = setInterval(() => void this.poll(), 1000);
    } else if (p.type === 'candidate') {
      if (!p.candidate) return;
      if (this.pc?.remoteDescription)
        await this.pc.addIceCandidate(p.candidate).catch(() => undefined);
      else this.pendingCandidates.push(p.candidate);
    }
  }

  setTally(state: TallyState): void {
    this.set({ tally: state });
    this.sendCtl({ t: 'tally', state });
  }

  setCameraBitrate(bps: number): void {
    this.sendCtl({ t: 'cam.setBitrate', bps });
  }

  setCameraZoom(zoom: number): void {
    this.sendCtl({ t: 'cam.setZoom', zoom });
  }

  /** The operator chose this phone as the sound source (reset when the camera is closed). */
  get phoneAudioWanted(): boolean {
    return this.audioWanted;
  }

  /** Ask the phone to send (or stop sending) its sound. Only on an explicit operator choice (C-04). */
  setPhoneAudio(on: boolean): void {
    this.audioWanted = on;
    this.sendCtl({ t: 'cam.setAudio', on });
  }

  close(): void {
    this.reset();
    this.video.srcObject = null;
    this.audioWanted = false;
    this.audioSink.srcObject = null;
    this.set({
      connection: 'idle',
      summary: null,
      quality: 'disconnected',
      camState: null,
      audioStream: null,
    });
  }

  private reset(): void {
    this.clearDeadline();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.ctl?.close();
    this.ctl = null;
    this.pc?.close();
    this.pc = null;
    this.prev = null;
    this.pendingCandidates = [];
  }

  private clearDeadline(): void {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
  }

  private sendCtl(m: CtlMessage): void {
    if (this.ctl?.readyState !== 'open') return;
    const env: CtlEnvelope = { v: 1, seq: ++this.seq, gen: this.generation(), m };
    this.ctl.send(JSON.stringify(env));
  }

  private onCtl(data: unknown): void {
    if (typeof data !== 'string' || data.length > 8192) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const r = CtlEnvelopeSchema.safeParse(parsed);
    if (!r.success || r.data.gen < this.generation()) return;
    const m = r.data.m;
    if (m.t === 'cam.state') this.set({ camState: m });
    if (m.t === 'ping') this.sendCtl({ t: 'pong', at: m.at });
  }

  private async poll(): Promise<void> {
    if (!this.pc) return;
    const report = toMap(await this.pc.getStats());
    const sample = sampleInboundVideo(report, performance.now());
    const summary = sample ? summarizeInbound(this.prev, sample) : null;
    this.prev = sample;
    const connected = this.pc.connectionState === 'connected';
    const quality = linkQuality(summary, connected);
    this.set({ summary, route: classifyRoute(report, this.wanBlockTestPassed()), quality });
    this.sendCtl({
      t: 'quality',
      label: quality,
      fps: summary?.fps ?? null,
      height: summary?.height ?? null,
      rttMs: summary?.rttMs ?? null,
    });
  }
}
