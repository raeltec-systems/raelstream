import type { CtlEnvelope, CtlMessage, SignalPayload, TallyState } from '@raelstream/contracts';
import { CtlEnvelope as CtlEnvelopeSchema } from '@raelstream/contracts';

export type CaptureError =
  'CAM_PERMISSION_DENIED' | 'CAM_IN_USE' | 'CAM_NOT_FOUND' | 'CAM_UNSUPPORTED';

export interface CaptureInfo {
  requested: { width: number; height: number; fps: number };
  actual: { width: number | null; height: number | null; fps: number | null };
  deviceLabel: string;
  zoom: { min: number; max: number; step: number; value: number } | null;
}

export type PhoneAudioState = 'off' | 'starting' | 'on' | 'denied' | 'unavailable' | 'error';

export interface PhoneAudio {
  state: PhoneAudioState;
  label: string | null;
  channels: number | null;
  processingOn: string[];
}

export interface SenderState {
  capture: 'idle' | 'starting' | 'live' | 'stopped' | 'error';
  captureError: CaptureError | null;
  info: CaptureInfo | null;
  connection: RTCPeerConnectionState | 'idle';
  tally: TallyState;
  quality: 'good' | 'reduced' | 'unstable' | 'disconnected';
  rttMs: number | null;
  wakeLock: 'active' | 'released' | 'unsupported';
  battery: { level: number; charging: boolean } | null;
  devices: MediaDeviceInfo[];
  /** Phone sound for the programme: off unless the studio operator chose this phone (C-04 decision). */
  audio: PhoneAudio;
}

const FULL_HD = { width: 1920, height: 1080, fps: 30 };
const HD = { width: 1280, height: 720, fps: 30 };

export function mapCaptureError(e: unknown): CaptureError {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'CAM_PERMISSION_DENIED';
  if (name === 'NotReadableError' || name === 'AbortError') return 'CAM_IN_USE';
  if (name === 'NotFoundError') return 'CAM_NOT_FOUND';
  return 'CAM_UNSUPPORTED';
}

/** Build video-only constraints (CAM-02: the camera never requests audio; phone sound is separate). */
export function videoConstraints(
  target: { width: number; height: number; fps: number },
  deviceId?: string,
): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      width: { ideal: target.width },
      height: { ideal: target.height },
      frameRate: { ideal: target.fps, max: target.fps },
    },
  };
}

/**
 * Phone sound when the operator picks this phone as the audio source (SPEC §8.8 decision): processing
 * off, like the mixer input, so an iRig or a clip-on mic is not gated or pumped by the phone.
 */
export function phoneAudioConstraints(): MediaStreamConstraints {
  return {
    video: false,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
    },
  };
}

/** Opus bitrate for programme sound (music and speech); the browser default targets voice calls. */
export const PHONE_AUDIO_BITRATE = 128_000;

const AUDIO_OFF: PhoneAudio = { state: 'off', label: null, channels: null, processingOn: [] };

type ZoomCaps = MediaTrackCapabilities & { zoom?: { min: number; max: number; step: number } };
type ZoomSettings = MediaTrackSettings & { zoom?: number };

/**
 * Phone camera sender (SPEC §7, §8). Offerer on the direct link; creates the `ctl` DataChannel before the
 * offer. No ICE servers (NET-02). Video only.
 */
export class CameraSender {
  state: SenderState = {
    capture: 'idle',
    captureError: null,
    info: null,
    connection: 'idle',
    tally: 'off',
    quality: 'disconnected',
    rttMs: null,
    wakeLock: 'unsupported',
    battery: null,
    devices: [],
    audio: AUDIO_OFF,
  };
  private listeners = new Set<() => void>();
  private stream: MediaStream | null = null;
  private audioStream: MediaStream | null = null;
  private audioWanted = false;
  private pc: RTCPeerConnection | null = null;
  private ctl: RTCDataChannel | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private seq = 0;
  private gen = 1;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private onVisibility = () => {
    if (document.visibilityState === 'visible' && this.state.capture === 'live')
      void this.acquireWakeLock();
    this.sendState();
  };

  constructor(private readonly sendSignal: (p: SignalPayload) => void) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(p: Partial<SenderState>): void {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  get previewStream(): MediaStream | null {
    return this.stream;
  }

  /** Must run from a user gesture (B§9.1). */
  async start(deviceId?: string): Promise<void> {
    this.set({ capture: 'starting', captureError: null });
    let stream: MediaStream;
    let requested = FULL_HD;
    try {
      stream = await navigator.mediaDevices.getUserMedia(videoConstraints(FULL_HD, deviceId));
    } catch (e) {
      if ((e as { name?: string }).name !== 'OverconstrainedError') return this.failCapture(e);
      requested = HD;
      try {
        stream = await navigator.mediaDevices.getUserMedia(videoConstraints(HD, deviceId));
      } catch (e2) {
        return this.failCapture(e2);
      }
    }
    if (stream.getAudioTracks().length > 0) {
      stream.getAudioTracks().forEach((t) => t.stop());
      throw new Error('audio track present on camera stream (CAM-02)');
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    const track = stream.getVideoTracks()[0]!;
    track.contentHint = 'motion';
    track.addEventListener('ended', () => this.set({ capture: 'stopped' }));
    const st = track.getSettings() as ZoomSettings;
    const caps = (track.getCapabilities?.() ?? {}) as ZoomCaps;
    const zoom = caps.zoom && typeof st.zoom === 'number' ? { ...caps.zoom, value: st.zoom } : null;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'videoinput',
    );
    this.set({
      capture: 'live',
      devices,
      info: {
        requested,
        actual: { width: st.width ?? null, height: st.height ?? null, fps: st.frameRate ?? null },
        deviceLabel: track.label,
        zoom,
      },
    });
    void this.acquireWakeLock();
    void this.readBattery();
    document.addEventListener('visibilitychange', this.onVisibility);
    await this.connect();
  }

  /** CAM-05: release camera, wake lock and peer connection. */
  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.releaseAudio();
    this.audioWanted = false;
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.ctl?.close();
    this.pc?.close();
    this.pc = null;
    this.ctl = null;
    this.set({
      capture: 'stopped',
      connection: 'idle',
      wakeLock: 'released',
      tally: 'off',
      audio: AUDIO_OFF,
    });
  }

  /**
   * Start or stop sending this phone's sound. Only ever called because the studio operator chose the
   * phone as the audio source; the track goes into the audio slot negotiated at connect time.
   */
  async setAudio(on: boolean): Promise<void> {
    this.audioWanted = on;
    if (!on) {
      this.releaseAudio();
      await this.audioSender()
        ?.replaceTrack(null)
        .catch(() => undefined);
      this.set({ audio: AUDIO_OFF });
      this.sendState();
      return;
    }
    if (this.audioStream) return;
    this.set({ audio: { ...AUDIO_OFF, state: 'starting' } });
    this.sendState();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(phoneAudioConstraints());
    } catch (e) {
      const name = (e as { name?: string }).name;
      const state: PhoneAudioState =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : name === 'NotFoundError'
            ? 'unavailable'
            : 'error';
      this.set({ audio: { ...AUDIO_OFF, state } });
      this.sendState();
      return;
    }
    if (!this.audioWanted) {
      stream.getTracks().forEach((t) => t.stop()); // the operator changed their mind meanwhile
      return;
    }
    this.audioStream = stream;
    const track = stream.getAudioTracks()[0]!;
    track.addEventListener('ended', () => {
      this.audioStream = null;
      this.set({ audio: { ...AUDIO_OFF, state: 'error' } });
      this.sendState();
    });
    const st = track.getSettings();
    const processingOn: string[] = [];
    if (st.echoCancellation) processingOn.push('echoCancellation');
    if (st.autoGainControl) processingOn.push('autoGainControl');
    if (st.noiseSuppression) processingOn.push('noiseSuppression');
    this.set({
      audio: { state: 'on', label: track.label, channels: st.channelCount ?? 1, processingOn },
    });
    await this.attachAudio();
    this.sendState();
  }

  private audioSender(): RTCRtpSender | undefined {
    return this.pc?.getTransceivers().find((t) => t.receiver.track.kind === 'audio')?.sender;
  }

  private async attachAudio(): Promise<void> {
    const sender = this.audioSender();
    const track = this.audioStream?.getAudioTracks()[0];
    if (!sender || !track) return;
    await sender.replaceTrack(track).catch(() => undefined);
    const p = sender.getParameters();
    p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: PHONE_AUDIO_BITRATE }];
    await sender.setParameters(p).catch(() => undefined);
  }

  private releaseAudio(): void {
    this.audioStream?.getTracks().forEach((t) => t.stop());
    this.audioStream = null;
  }

  async onSignal(p: SignalPayload): Promise<void> {
    if (!this.pc) return;
    if (p.type === 'answer') await this.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
    else if (p.type === 'candidate' && p.candidate)
      await this.pc.addIceCandidate(p.candidate).catch(() => undefined);
  }

  /** Server-side tally fallback when the DataChannel is down. */
  setTally(t: TallyState): void {
    this.set({ tally: t });
  }

  async setZoom(value: number): Promise<number | null> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || !this.state.info?.zoom) return null;
    await track
      .applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] })
      .catch(() => undefined);
    const applied = (track.getSettings() as ZoomSettings).zoom ?? null;
    if (applied !== null && this.state.info)
      this.set({ info: { ...this.state.info, zoom: { ...this.state.info.zoom, value: applied } } });
    this.sendState();
    return applied;
  }

  private failCapture(e: unknown): void {
    this.set({ capture: 'error', captureError: mapCaptureError(e) });
  }

  /** A new studio tab took over (E37): renegotiate with it, keeping the same slot and capture. */
  async renegotiate(): Promise<void> {
    if (this.state.capture === 'live' && this.stream) await this.connect();
  }

  private async connect(): Promise<void> {
    this.pc?.close();
    const pc = new RTCPeerConnection({
      iceServers: [],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    this.pc = pc;
    const ctl = pc.createDataChannel('ctl', { ordered: true });
    this.ctl = ctl;
    ctl.onmessage = (m) => this.onCtl(m.data);
    ctl.onopen = () => this.sendState();
    const track = this.stream!.getVideoTracks()[0]!;
    const tx = pc.addTransceiver(track, { direction: 'sendonly' });
    const caps = RTCRtpSender.getCapabilities?.('video');
    if (caps && typeof tx.setCodecPreferences === 'function') {
      const rank = (m: string) => (/h264/i.test(m) ? 0 : /vp8/i.test(m) ? 1 : 2);
      try {
        tx.setCodecPreferences(
          [...caps.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType)),
        );
      } catch {
        /* default order */
      }
    }
    // An empty audio slot, filled only if the operator picks this phone as the sound source, so that
    // switching needs no renegotiation. No microphone is opened until then.
    pc.addTransceiver('audio', { direction: 'sendonly' });
    if (this.audioStream) await this.attachAudio();
    const height = this.state.info?.actual.height ?? 1080;
    await this.setMaxBitrate(height >= 1080 ? 8_000_000 : 4_000_000);
    pc.addEventListener('icecandidate', (e) =>
      this.sendSignal({
        type: 'candidate',
        candidate: e.candidate ? (e.candidate.toJSON() as { candidate: string }) : null,
      }),
    );
    pc.addEventListener('connectionstatechange', () => {
      this.set({ connection: pc.connectionState });
      if (pc.connectionState === 'failed') this.set({ quality: 'disconnected' });
    });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal({ type: 'offer', sdp: offer.sdp ?? '' });
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.stateTimer = setInterval(() => this.sendState(), 5000);
  }

  private async setMaxBitrate(bps: number): Promise<void> {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) return;
    const p = sender.getParameters();
    p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: bps, maxFramerate: 30 }];
    p.degradationPreference = 'maintain-framerate';
    await sender.setParameters(p).catch(() => undefined);
  }

  private onCtl(data: unknown): void {
    if (typeof data !== 'string' || data.length > 8192) return;
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }
    const r = CtlEnvelopeSchema.safeParse(raw);
    if (!r.success) return;
    if (r.data.gen > this.gen) this.gen = r.data.gen;
    if (r.data.gen < this.gen) return;
    const m = r.data.m;
    if (m.t === 'tally') this.set({ tally: m.state });
    else if (m.t === 'quality') this.set({ quality: m.label, rttMs: m.rttMs });
    else if (m.t === 'cam.setBitrate') void this.setMaxBitrate(m.bps);
    else if (m.t === 'cam.setZoom') void this.setZoom(m.zoom);
    else if (m.t === 'cam.setAudio') void this.setAudio(m.on);
    this.sendCtl({ t: 'ack', of: r.data.seq });
  }

  private sendCtl(m: CtlMessage): void {
    if (this.ctl?.readyState !== 'open') return;
    const env: CtlEnvelope = { v: 1, seq: ++this.seq, gen: this.gen, m };
    this.ctl.send(JSON.stringify(env));
  }

  private sendState(): void {
    const i = this.state.info;
    this.sendCtl({
      t: 'cam.state',
      width: i?.actual.width ?? null,
      height: i?.actual.height ?? null,
      frameRate: i?.actual.fps ?? null,
      wakeLock: this.state.wakeLock,
      battery: this.state.battery,
      backgrounded: document.visibilityState === 'hidden',
      zoom: i?.zoom ?? null,
      audio: this.state.audio,
    });
  }

  private async acquireWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return this.set({ wakeLock: 'unsupported' });
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => this.set({ wakeLock: 'released' }));
      this.set({ wakeLock: 'active' });
    } catch {
      this.set({ wakeLock: 'released' });
    }
  }

  private async readBattery(): Promise<void> {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (e: string, f: () => void) => void;
      }>;
    };
    if (!nav.getBattery) return;
    try {
      const b = await nav.getBattery();
      const upd = () => this.set({ battery: { level: b.level, charging: b.charging } });
      upd();
      b.addEventListener('levelchange', upd);
      b.addEventListener('chargingchange', upd);
    } catch {
      /* unavailable */
    }
  }
}
