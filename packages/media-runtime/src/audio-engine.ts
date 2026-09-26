import { Observable } from './emitter.js';
import { loadMeterWorklet } from './meter-worklet.js';
import {
  type RoutingMode,
  SilenceDetector,
  availableModes,
  clampDelayMs,
  gainDbToLinear,
  routingGains,
  toDbfs,
} from './audio-math.js';

/** `holdDb` keeps the highest recent peak for 1.5 s so meters are readable (SPEC §10.4 step 5). */
export interface MeterReading {
  peakDb: [number, number];
  holdDb: [number, number];
  rmsDb: [number, number];
  clip: boolean;
}

const PEAK_HOLD_MS = 1500;
const SOUND_RECENT_MS = 3000;
const SOUND_THRESHOLD_DB = -60;
const SILENCE_SNOOZE_MS = 5 * 60_000;

class PeakHold {
  private db: [number, number] = [-90, -90];
  private until: [number, number] = [0, 0];
  update(peak: [number, number], now: number): [number, number] {
    for (const c of [0, 1] as const) {
      if (peak[c] >= this.db[c] || now > this.until[c]) {
        this.db[c] = peak[c];
        this.until[c] = now + PEAK_HOLD_MS;
      }
    }
    return [this.db[0], this.db[1]];
  }
}

export interface AudioEngineState {
  status: 'idle' | 'starting' | 'running' | 'device_lost' | 'error';
  /** Where the sound comes from: a USB/built-in input on this laptop, or the camera phone. */
  source: 'device' | 'phone' | null;
  deviceLabel: string | null;
  channelCount: number | null;
  sampleRate: number | null;
  /** Processing the browser would not turn off (warn, SPEC §10.4 step 1). */
  processingNotDisabled: string[];
  mode: RoutingMode;
  availableModes: RoutingMode[];
  gainDb: number;
  hpf: boolean;
  compressor: boolean;
  muted: boolean;
  /** Programme sound on this computer's output (off by default; headphones recommended, B§12.5). */
  monitor: boolean;
  delayMs: number;
  input: MeterReading;
  programme: MeterReading;
  clipCount: number;
  silent: boolean;
  /** Input above −60 dBFS within the last 3 s (for the "Sound detected" chip). */
  soundRecent: boolean;
  /** The lost interface is plugged in again: offer "Reconnect" (A18). */
  deviceBack: { deviceId: string; label: string } | null;
  error: string | null;
}

const SILENT: MeterReading = {
  peakDb: [-90, -90],
  holdDb: [-90, -90],
  rmsDb: [-90, -90],
  clip: false,
};
const CROSSFADE_S = 0.04;

/**
 * One persistent AudioContext for mixer audio (SPEC §10.4). Graph:
 * source → splitter → routing matrix → merger → [input meter] → gain → HPF → compressor → mute →
 * crossfaded dual delay → [programme meter] → MediaStreamDestination (programme track).
 * The optional monitor never connects back into the destination. No automatic device substitution.
 */
export class AudioEngine extends Observable<AudioEngineState> {
  readonly ctx: AudioContext;
  private readonly dest: MediaStreamAudioDestinationNode;
  private stream: MediaStream | null = null;
  private ownsStream = false;
  private source: MediaStreamAudioSourceNode | null = null;
  private splitter: ChannelSplitterNode;
  private matrix: GainNode[];
  private merger: ChannelMergerNode;
  private gain: GainNode;
  private hpf: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private mute: GainNode;
  private delays: [DelayNode, DelayNode];
  private delayGains: [GainNode, GainNode];
  private activeDelay: 0 | 1 = 0;
  private post: GainNode;
  private monitor: GainNode;
  private inputMeter: AudioWorkletNode | null = null;
  private programmeMeter: AudioWorkletNode | null = null;
  private silence = new SilenceDetector();
  private inputHold = new PeakHold();
  private programmeHold = new PeakHold();
  private lastSoundAt = 0;
  private silenceMutedUntil = 0;
  private ready: Promise<void>;
  private onDeviceChange = () => void this.checkDevicePresent();

  constructor() {
    super({
      status: 'idle',
      source: null,
      deviceLabel: null,
      channelCount: null,
      sampleRate: null,
      processingNotDisabled: [],
      mode: 'in1_both',
      availableModes: ['in1_both'],
      gainDb: 0,
      hpf: false,
      compressor: false,
      muted: false,
      monitor: false,
      delayMs: 0,
      input: SILENT,
      programme: SILENT,
      clipCount: 0,
      silent: false,
      soundRecent: false,
      deviceBack: null,
      error: null,
    });
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.ctx = ctx;
    this.splitter = ctx.createChannelSplitter(2);
    this.merger = ctx.createChannelMerger(2);
    this.matrix = [0, 1, 2, 3].map(() => ctx.createGain());
    // matrix[0]: in1→L, [1]: in2→L, [2]: in1→R, [3]: in2→R
    this.splitter.connect(this.matrix[0]!, 0);
    this.splitter.connect(this.matrix[1]!, 1);
    this.splitter.connect(this.matrix[2]!, 0);
    this.splitter.connect(this.matrix[3]!, 1);
    this.matrix[0]!.connect(this.merger, 0, 0);
    this.matrix[1]!.connect(this.merger, 0, 0);
    this.matrix[2]!.connect(this.merger, 0, 1);
    this.matrix[3]!.connect(this.merger, 0, 1);
    this.gain = ctx.createGain();
    this.hpf = ctx.createBiquadFilter();
    this.hpf.type = 'highpass';
    this.hpf.frequency.value = 80;
    this.hpf.Q.value = 0.707;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 2.5;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.25;
    this.mute = ctx.createGain();
    this.delays = [ctx.createDelay(2.1), ctx.createDelay(2.1)];
    this.delayGains = [ctx.createGain(), ctx.createGain()];
    this.delayGains[1].gain.value = 0;
    this.post = ctx.createGain();
    this.dest = ctx.createMediaStreamDestination();
    this.dest.channelCount = 2;
    this.monitor = ctx.createGain();
    this.monitor.gain.value = 0;

    this.merger.connect(this.gain);
    this.rebuildProcessingChain();
    for (const i of [0, 1] as const) {
      this.mute.connect(this.delays[i]);
      this.delays[i].connect(this.delayGains[i]);
      this.delayGains[i].connect(this.post);
    }
    this.post.connect(this.dest);
    this.post.connect(this.monitor);
    this.monitor.connect(ctx.destination);
    this.applyRouting('in1_both');

    this.ready = loadMeterWorklet(ctx).then(() => {
      this.inputMeter = new AudioWorkletNode(ctx, 'rs-meter', {
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      this.programmeMeter = new AudioWorkletNode(ctx, 'rs-meter', {
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      this.merger.connect(this.inputMeter);
      this.post.connect(this.programmeMeter);
      this.inputMeter.port.onmessage = (e) => this.onInputMeter(e.data);
      this.programmeMeter.port.onmessage = (e) =>
        this.set({ programme: this.reading(e.data, this.programmeHold) });
    });
    this.ready.catch(() => undefined); // reported by selectDevice
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
  }

  /** The long-lived programme audio track. */
  get track(): MediaStreamTrack {
    return this.dest.stream.getAudioTracks()[0]!;
  }

  /**
   * Browsers hide input names (and often IDs) until the page has microphone permission; ask once so
   * the list shows real devices. The probe stream is stopped straight away.
   */
  async requestAccess(): Promise<'granted' | 'denied' | 'unavailable'> {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const track of probe.getTracks()) track.stop();
      return 'granted';
    } catch (e) {
      return (e as DOMException).name === 'NotFoundError' ? 'unavailable' : 'denied';
    }
  }

  async listInputs(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  /** Capture the selected device with processing off (B§12.1). Must be called from a user gesture on first use. */
  async selectDevice(deviceId: string): Promise<void> {
    this.set({ status: 'starting', error: null, deviceBack: null });
    this.releaseSource();
    try {
      // Without the meters there is no way to check sound, so a failed load is a visible error.
      await this.ready;
      await this.ctx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48000 },
        },
      });
      const track = stream.getAudioTracks()[0]!;
      const st = track.getSettings();
      const notOff: string[] = [];
      if (st.echoCancellation) notOff.push('echoCancellation');
      if (st.autoGainControl) notOff.push('autoGainControl');
      if (st.noiseSuppression) notOff.push('noiseSuppression');
      this.attach(stream, {
        source: 'device',
        label: track.label,
        channels: st.channelCount ?? 1,
        sampleRate: st.sampleRate ?? this.ctx.sampleRate,
        processingNotDisabled: notOff,
      });
    } catch (e) {
      this.set({ status: 'error', error: (e as Error).name });
    }
  }

  /**
   * Use the camera phone's sound (SPEC §8.8 decision). Only on the operator's explicit choice; the
   * engine never falls back to it (C-04). The phone reports its own channel count and processing.
   */
  async selectPhone(
    stream: MediaStream,
    info: { label: string; channels: number; processingNotDisabled: string[] },
  ): Promise<void> {
    this.set({ status: 'starting', error: null });
    this.releaseSource();
    try {
      await this.ready;
      await this.ctx.resume();
      this.attach(stream, {
        source: 'phone',
        label: info.label,
        channels: info.channels,
        sampleRate: this.ctx.sampleRate,
        processingNotDisabled: info.processingNotDisabled,
      });
    } catch (e) {
      this.set({ status: 'error', error: (e as Error).name });
    }
  }

  /** The phone's report changed (channels, processing, name) while it is the source. */
  updatePhoneInfo(info: {
    label: string;
    channels: number;
    processingNotDisabled: string[];
  }): void {
    if (this.state.source !== 'phone') return;
    const modes = availableModes(info.channels);
    const mode = modes.includes(this.state.mode) ? this.state.mode : 'in1_both';
    if (mode !== this.state.mode) this.applyRouting(mode);
    this.set({
      deviceLabel: info.label,
      channelCount: info.channels,
      processingNotDisabled: info.processingNotDisabled,
      availableModes: modes,
      mode,
    });
  }

  /** The phone link dropped or the phone stopped its sound: silence, never a substitute (C-04). */
  phoneLost(): void {
    if (this.state.source === 'phone' && this.state.status === 'running') this.handleLoss();
  }

  private attach(
    stream: MediaStream,
    info: {
      source: 'device' | 'phone';
      label: string;
      channels: number;
      sampleRate: number;
      processingNotDisabled: string[];
    },
  ): void {
    const track = stream.getAudioTracks()[0]!;
    track.addEventListener('ended', () => {
      if (this.stream === stream) this.handleLoss();
    });
    this.stream = stream;
    this.ownsStream = info.source === 'device';
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.splitter);
    const modes = availableModes(info.channels);
    const mode = modes.includes(this.state.mode) ? this.state.mode : 'in1_both';
    this.applyRouting(mode);
    this.set({
      status: 'running',
      source: info.source,
      deviceLabel: info.label,
      channelCount: info.channels,
      sampleRate: info.sampleRate,
      processingNotDisabled: info.processingNotDisabled,
      availableModes: modes,
      mode,
    });
  }

  setMode(mode: RoutingMode): void {
    if (!this.state.availableModes.includes(mode)) return;
    this.applyRouting(mode);
    this.set({ mode });
  }

  setGainDb(db: number): void {
    const v = Math.max(-24, Math.min(12, db));
    this.gain.gain.setTargetAtTime(gainDbToLinear(v), this.ctx.currentTime, 0.02);
    this.set({ gainDb: v });
  }

  setHpf(on: boolean): void {
    this.set({ hpf: on });
    this.rebuildProcessingChain();
  }

  setCompressor(on: boolean): void {
    this.set({ compressor: on });
    this.rebuildProcessingChain();
  }

  setMuted(muted: boolean): void {
    this.mute.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.01);
    this.set({ muted });
  }

  /** Crossfaded delay change avoids pitch artefacts from moving delayTime on a live line (SPEC §10.4 step 3). */
  setDelayMs(ms: number): number {
    const v = clampDelayMs(ms);
    const next = (this.activeDelay === 0 ? 1 : 0) as 0 | 1;
    const now = this.ctx.currentTime;
    this.delays[next].delayTime.setValueAtTime(v / 1000, now);
    this.delayGains[next].gain.setValueAtTime(0, now);
    this.delayGains[next].gain.linearRampToValueAtTime(1, now + CROSSFADE_S);
    this.delayGains[this.activeDelay].gain.setValueAtTime(
      this.delayGains[this.activeDelay].gain.value,
      now,
    );
    this.delayGains[this.activeDelay].gain.linearRampToValueAtTime(0, now + CROSSFADE_S);
    this.activeDelay = next;
    this.set({ delayMs: v });
    return v;
  }

  setMonitor(on: boolean): void {
    void this.ctx.resume(); // called from a click, so the browser allows audio output
    this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    this.set({ monitor: on });
  }

  /** "This is intentional": no silence warning for 5 minutes (SPEC §10.4.6). Never changes gain. */
  acknowledgeSilence(now = performance.now()): void {
    this.silence.reset();
    this.silenceMutedUntil = now + SILENCE_SNOOZE_MS;
    this.set({ silent: false });
  }

  /** The lost interface is back (A18): reselect it by its new id. Only on the operator's click. */
  async reconnectDevice(): Promise<void> {
    const back = this.state.deviceBack;
    if (!back) return;
    this.set({ deviceBack: null });
    await this.selectDevice(back.deviceId);
  }

  dispose(): void {
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    this.releaseSource();
    void this.ctx.close();
  }

  private applyRouting(mode: RoutingMode): void {
    const g = routingGains(mode);
    g.forEach((v, i) => this.matrix[i]!.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01));
  }

  private rebuildProcessingChain(): void {
    this.gain.disconnect();
    this.hpf.disconnect();
    this.comp.disconnect();
    let node: AudioNode = this.gain;
    if (this.state.hpf) {
      node.connect(this.hpf);
      node = this.hpf;
    }
    if (this.state.compressor) {
      node.connect(this.comp);
      node = this.comp;
    }
    node.connect(this.mute);
  }

  private reading(
    d: { peak: [number, number]; rms: [number, number]; clip: boolean },
    hold: PeakHold,
  ): MeterReading {
    const peakDb: [number, number] = [toDbfs(d.peak[0]), toDbfs(d.peak[1])];
    return {
      peakDb,
      holdDb: hold.update(peakDb, performance.now()),
      rmsDb: [toDbfs(d.rms[0]), toDbfs(d.rms[1])],
      clip: d.clip,
    };
  }

  private onInputMeter(d: { peak: [number, number]; rms: [number, number]; clip: boolean }): void {
    const now = performance.now();
    const input = this.reading(d, this.inputHold);
    if (Math.max(...input.peakDb) > SOUND_THRESHOLD_DB) this.lastSoundAt = now;
    const running = this.state.status === 'running';
    const quiet = this.silence.update(Math.max(...input.rmsDb), now);
    const silent = running && !this.state.muted && now >= this.silenceMutedUntil && quiet;
    const soundRecent = running && now - this.lastSoundAt < SOUND_RECENT_MS;
    this.set({ input, silent, soundRecent, clipCount: this.state.clipCount + (d.clip ? 1 : 0) });
  }

  private releaseSource(): void {
    this.source?.disconnect();
    this.source = null;
    // The phone's stream belongs to the camera link; stopping it would end the phone's audio slot.
    if (this.ownsStream) this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /** Device lost: keep the graph (programme track outputs silence), never substitute another input (C-04). */
  private handleLoss(): void {
    this.releaseSource();
    this.set({ status: 'device_lost', input: SILENT });
  }

  private async checkDevicePresent(): Promise<void> {
    if (this.state.source !== 'device' || !this.state.deviceLabel) return;
    const inputs = await this.listInputs();
    const match = inputs.find((d) => d.label === this.state.deviceLabel);
    if (this.state.status === 'running' && !match) this.handleLoss();
    // Offer the same interface back when it reappears; never select it (or anything) by itself.
    if (this.state.status === 'device_lost' && match?.deviceId)
      this.set({ deviceBack: { deviceId: match.deviceId, label: match.label } });
  }
}
