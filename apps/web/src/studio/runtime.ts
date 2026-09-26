import type {
  IngestResponse,
  SessionSnapshot,
  SignalPayload,
  TallyState,
  ServerMessage,
  CreatePairingResponse,
  DestinationSummary,
  ObservedState,
  SessionLifecycle,
  SessionDestination,
  Theme,
  UplinkResult,
} from '@raelstream/contracts';
import { uplinkOffer } from '@raelstream/contracts';
import {
  AudioEngine,
  CameraReceiver,
  Compositor,
  Observable,
  WhipPublisher,
  type ProgrammeTheme,
  type RoutingMode,
  type SceneKind,
  type TextCard,
  textCardFits,
  CAMERA_STEPS,
  CPU_STEPS,
  StepController,
  UPLOAD_STEPS,
  cameraLinkStruggling,
  uploadCongested,
} from '@raelstream/media-runtime';
import { api, ApiFailure, clientId, getCsrf } from '../lib/api.js';
import { FONT_FAMILY, assetBitmap, programmeTheme } from '../lib/theme.js';
import { t } from '@raelstream/i18n';
import { SessionSocket } from '../lib/ws.js';
import { fromServerRundown, toServerRundown, type RundownItem } from './rundown.js';

export type Profile = 'reliable_hd' | 'full_hd';
export const PROFILE_SIZE: Record<
  Profile,
  { w: number; h: number; ceiling: number; label: string }
> = {
  reliable_hd: { w: 1280, h: 720, ceiling: 4_500_000, label: '720p30' },
  full_hd: { w: 1920, h: 1080, ceiling: 8_000_000, label: '1080p30' },
};

export interface StudioState {
  session: SessionSnapshot | null;
  socket: 'connecting' | 'open' | 'closed';
  cameraPresent: Record<string, boolean>;
  invitation: CreatePairingResponse | null;
  profile: Profile;
  contribution: 'idle' | 'starting' | 'sending' | 'error';
  contributionError: string | null;
  rundown: RundownItem[];
  onAirIndex: number | null;
  scene: SceneKind;
  lastLowerThird: number | null;
  lastText: number | null;
  wanBlockTestPassed: boolean;
  productionSsid: string;
  sendingSince: number | null;
  /** Media-node truth from the supervisor (SPEC §12.1); null until first report. */
  observed: ObservedState | null;
  lifecycle: SessionLifecycle | null;
  destinations: DestinationSummary[];
  liveDestinationIds: string[];
  /** Destinations this service will use (Preparation → Destinations); Go live starts with these. */
  selectedDestinationIds: string[];
  /** Per-service destination state: Facebook's key ending, the operator's live confirmation. */
  sessionDestinations: SessionDestination[];
  /** Automatic quality steps (SPEC §11.5): index 0 = full quality. */
  quality: { upload: number; cpu: number; camera: number };
  uplink: {
    status: 'idle' | 'running' | 'done' | 'error';
    progressMbps: number | null;
    result: UplinkResult | null;
  };
  commandError: string | null;
  /** Record the next private test (on by default: a test is for watching back). */
  recordTest: boolean;
  /** Stop intent survives a reload and clears only after server confirmation. */
  stopPending: boolean;
  resumeNeeded: boolean;
  /** Studio lease (SPEC §9.10): only the holder may send commands; others are read-only. */
  lease: {
    mine: boolean;
    holderName: string | null;
    holderIsMe: boolean;
    canTakeOver: boolean;
  } | null;
  presetId: string | null;
  presetName: string | null;
  /** Saved device label from the preset/session, shown as a hint (labels need permission to match). */
  savedAudioDevice: string | null;
  /** Camera framing in the 16:9 programme (A13): fit shows the whole picture, fill crops to the frame. */
  framing: 'contain' | 'fill';
  /** The church theme as saved (for layout checks and previews). */
  churchTheme: Theme | null;
  /** Latest good lip-sync calibration (SPEC §11.4). */
  calibration: SyncCalibration | null;
  /** Set when something changed that calls for a new sync check (A18, A20). */
  syncRecheck: string | null;
}

export interface SyncCalibration {
  sourceFingerprint: string;
  audioMapping: string;
  audioDeviceLabel: string;
  profile: string;
  offsetMs: number;
  measuredAt: string;
}
export interface SyncFingerprint {
  source: string;
  audioDeviceLabel: string;
  audioMapping: string;
  profile: string;
}
const APP_VERSION = '0.6.0';

export interface SessionConfig {
  presetId: string | null;
  presetName: string | null;
  destinationIds: string[];
  profile: Profile;
  fallbackGraceS: number;
  uplinkTest: UplinkResult | null;
  rundown: unknown[];
  audio: {
    deviceLabel?: string | null;
    mode?: RoutingMode;
    gainDb?: number;
    hpf?: boolean;
    compressor?: boolean;
    delayMs?: number;
  };
}

function textOf(item: { title: string; detail: string; reference?: string }): TextCard {
  return { title: item.title, detail: item.detail, reference: item.reference || undefined };
}

export const LIVE_STATES: SessionLifecycle[] = [
  'STARTING',
  'SENDING',
  'PARTIAL',
  'RECOVERING',
  'STOPPING',
];

/**
 * One persistent media runtime per studio page (SPEC §10.1). React reads it through stores; route changes
 * never recreate the camera link, audio graph or contribution.
 */
export class StudioRuntime extends Observable<StudioState> {
  readonly audio: AudioEngine;
  compositor: Compositor;
  readonly camera: CameraReceiver;
  whip: WhipPublisher | null = null;
  private socket: SessionSocket | null = null;
  private readonly clientId = clientId;
  private leaseTimer: ReturnType<typeof setInterval> | null = null;
  private bitmaps = new Map<string, ImageBitmap>();
  private rundownSave: ReturnType<typeof setTimeout> | null = null;
  private audioSave: ReturnType<typeof setTimeout> | null = null;
  private pendingAudio: SessionConfig['audio'] | null = null;
  private lastSequence = 0;

  constructor() {
    super({
      session: null,
      socket: 'connecting',
      cameraPresent: {},
      invitation: null,
      profile: 'reliable_hd',
      contribution: 'idle',
      recordTest: true,
      contributionError: null,
      rundown: [],
      onAirIndex: null,
      scene: 'slate',
      lastLowerThird: null,
      lastText: null,
      wanBlockTestPassed: false,
      productionSsid: '',
      sendingSince: null,
      observed: null,
      lifecycle: null,
      destinations: [],
      liveDestinationIds: [],
      selectedDestinationIds: [],
      sessionDestinations: [],
      uplink: { status: 'idle', progressMbps: null, result: null },
      quality: { upload: 0, cpu: 0, camera: 0 },
      commandError: null,
      stopPending: false,
      resumeNeeded: false,
      lease: null,
      presetId: null,
      presetName: null,
      savedAudioDevice: null,
      framing: 'contain',
      churchTheme: null,
      calibration: null,
      syncRecheck: null,
    });
    this.audio = new AudioEngine();
    this.compositor = new Compositor(PROFILE_SIZE.reliable_hd.w, PROFILE_SIZE.reliable_hd.h);
    this.camera = new CameraReceiver(
      (payload) => this.sendSignal(payload),
      () => this.state.session?.generation ?? 1,
      () => this.state.wanBlockTestPassed,
    );
    this.compositor.setCamera(this.camera.video);
    this.compositor.subscribe(() => this.onCompositor());
    this.camera.subscribe(() => {
      this.syncTally();
      this.syncPhoneAudio();
    });
    setInterval(() => this.adaptTick(), 1000);
    window.addEventListener('beforeunload', (e) => {
      if (this.contributionWanted || this.state.stopPending) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.addEventListener('visibilitychange', () => {
      // E11: switching tabs is fine now, but the report should show it happened while sending.
      if (document.visibilityState === 'hidden' && this.isLive) void this.logEvent('studio.hidden');
    });
  }

  // ---- adaptation (SPEC §11.5): two independent controllers, 1 Hz; audio is never touched ----
  private uploadCtl = new StepController(UPLOAD_STEPS.reliable_hd.length);
  private cpuCtl = new StepController(CPU_STEPS.length);
  private cameraCtl = new StepController(CAMERA_STEPS.length);

  // ---- statistics for the report (SPEC §19): 1 Hz samples, uploaded as 10 s aggregates ----
  private samples: Array<Record<string, number | string | null>> = [];
  private windowStart = Date.now();
  private lastClips = 0;

  private sample(): void {
    const cam = this.camera.snapshot;
    const w = this.whip?.snapshot;
    const a = this.audio.snapshot;
    const active = cam.connection === 'connected' || w?.status === 'connected';
    if (!active || !this.state.session || !this.state.lease?.mine) {
      this.samples = [];
      this.windowStart = Date.now();
      return;
    }
    this.samples.push({
      cameraFps: cam.summary?.fps ?? null,
      cameraLossPct: cam.summary?.lossPct ?? null,
      cameraRttMs: cam.summary?.rttMs ?? null,
      jitterBufferMs: cam.summary?.jitterBufferMs ?? null,
      uploadMbps: w?.bitrateBps != null ? w.bitrateBps / 1e6 : null,
      uploadRttMs: w?.rttMs ?? null,
      encodeFps: w?.framesPerSecond ?? null,
      ql: w?.qualityLimitation ?? null,
      peakDb: a.status === 'running' ? Math.max(...a.programme.peakDb) : null,
      silent: a.silent ? 1 : 0,
    });
    if (this.samples.length >= 10) void this.flushWindow();
  }

  private async flushWindow(): Promise<void> {
    const rows = this.samples;
    const start = this.windowStart;
    this.samples = [];
    this.windowStart = Date.now();
    const stat = (k: string) => {
      const v = rows.map((r) => r[k]).filter((x): x is number => typeof x === 'number');
      if (!v.length) return { min: null, avg: null, max: null };
      const r1 = (n: number) => Math.round(n * 100) / 100;
      return {
        min: r1(Math.min(...v)),
        avg: r1(v.reduce((x, y) => x + y, 0) / v.length),
        max: r1(Math.max(...v)),
      };
    };
    const ql: Record<string, number> = {};
    for (const r of rows) if (typeof r.ql === 'string') ql[r.ql] = (ql[r.ql] ?? 0) + 1;
    const peaks = rows.map((r) => r.peakDb).filter((x): x is number => typeof x === 'number');
    const clips = this.audio.snapshot.clipCount;
    const body = {
      windowStart: new Date(start).toISOString(),
      windowS: rows.length,
      metrics: {
        cameraFps: stat('cameraFps'),
        cameraLossPct: stat('cameraLossPct'),
        cameraRttMs: stat('cameraRttMs'),
        jitterBufferMs: stat('jitterBufferMs'),
        uploadMbps: stat('uploadMbps'),
        uploadRttMs: stat('uploadRttMs'),
        encodeFps: stat('encodeFps'),
        qualityLimitation: ql,
        audioPeakMaxDb: peaks.length ? Math.round(Math.max(...peaks) * 10) / 10 : null,
        clips: Math.max(0, clips - this.lastClips),
        silenceS: rows.reduce((n, r) => n + (r.silent === 1 ? 1 : 0), 0),
        qualitySteps: this.state.quality,
      },
    };
    this.lastClips = clips;
    const s = this.state.session;
    if (s) await api('POST', `/api/sessions/${s.id}/diagnostics`, body).catch(() => undefined);
  }

  private adaptTick(now = performance.now()): void {
    this.recoveryTick();
    this.sample();
    const w = this.whip?.snapshot;
    if (w?.status === 'connected') {
      const steps = UPLOAD_STEPS[this.state.profile];
      if (this.uploadCtl.steps !== steps.length) this.uploadCtl = new StepController(steps.length);
      const ceiling = steps[this.uploadCtl.index]!;
      const up = this.uploadCtl.update(
        uploadCongested({ ...w, sentBps: w.bitrateBps }, ceiling),
        now,
      );
      const cpu = this.cpuCtl.update(w.qualityLimitation === 'cpu', now);
      if (up || cpu) {
        const e = CPU_STEPS[this.cpuCtl.index]!;
        void this.whip?.setEncoding({ maxBitrate: steps[this.uploadCtl.index]!, ...e });
        this.set({
          quality: { ...this.state.quality, upload: this.uploadCtl.index, cpu: this.cpuCtl.index },
        });
        if (up)
          void this.logEvent(
            up.direction === 'down' ? 'quality.upload_reduced' : 'quality.upload_restored',
            {
              mbps: steps[this.uploadCtl.index]! / 1e6,
            },
          );
        if (cpu)
          void this.logEvent(
            cpu.direction === 'down' ? 'quality.cpu_reduced' : 'quality.cpu_restored',
            {
              step: this.cpuCtl.index,
            },
          );
      }
    } else if (this.uploadCtl.index || this.cpuCtl.index) {
      this.uploadCtl.reset();
      this.cpuCtl.reset();
      this.set({ quality: { ...this.state.quality, upload: 0, cpu: 0 } });
    }

    const cam = this.camera.snapshot;
    if (cam.connection === 'connected' && cam.summary) {
      const ch = this.cameraCtl.update(
        cameraLinkStruggling({
          receivedFps: cam.summary.fps,
          captureFps: cam.camState?.frameRate ?? null,
          lossPct: cam.summary.lossPct,
          freezesDelta: null,
        }),
        now,
      );
      if (ch) {
        const bps = CAMERA_STEPS[this.cameraCtl.index]!;
        this.camera.setCameraBitrate(bps);
        this.set({ quality: { ...this.state.quality, camera: this.cameraCtl.index } });
        void this.logEvent(
          ch.direction === 'down' ? 'quality.camera_reduced' : 'quality.camera_restored',
          {
            mbps: bps / 1e6,
          },
        );
      }
    } else if (this.cameraCtl.index) {
      this.cameraCtl.reset();
      this.set({ quality: { ...this.state.quality, camera: 0 } });
    }
  }

  /** Studio-side events for the service timeline and report (SPEC §19). Best effort. */
  async logEvent(kind: string, data: Record<string, unknown> = {}): Promise<void> {
    const s = this.state.session;
    if (!s || !this.state.lease?.mine) return;
    await api('POST', `/api/sessions/${s.id}/events`, { kind, data }).catch(() => undefined);
  }

  // ---- audio source ----
  /** A USB or built-in input on this laptop (the normal case: the mixer through the interface). */
  async selectAudioDevice(deviceId: string): Promise<void> {
    if (this.camera.phoneAudioWanted) this.camera.setPhoneAudio(false);
    this.phoneAudioStream = null;
    await this.audio.selectDevice(deviceId);
  }

  /** The interface is back: reselect it, and ask for a sync recheck (A18). */
  async reconnectAudio(): Promise<void> {
    await this.audio.reconnectDevice();
    this.markSyncRecheck('audio_reconnected');
  }

  /**
   * The camera phone's sound (SPEC §8.8 decision): its microphone, or an iRig/line input plugged into
   * it. Only ever on the operator's explicit choice; nothing switches to it automatically (C-04).
   */
  usePhoneAudio(): void {
    this.camera.setPhoneAudio(true);
    this.syncPhoneAudio();
  }

  private phoneAudioStream: MediaStream | null = null;
  private syncPhoneAudio(): void {
    if (!this.camera.phoneAudioWanted) return;
    const cam = this.camera.snapshot;
    const report = cam.camState?.audio;
    const stream = cam.audioStream;
    const live = cam.connection === 'connected' && report?.state === 'on' && !!stream;
    const eng = this.audio.snapshot;
    if (!live) {
      if (this.phoneAudioStream) this.audio.phoneLost();
      this.phoneAudioStream = null;
      return;
    }
    const info = {
      label: report.label || 'Phone microphone',
      channels: report.channels ?? 1,
      processingNotDisabled: report.processingOn,
    };
    if (
      this.phoneAudioStream !== stream ||
      eng.source !== 'phone' ||
      eng.status === 'device_lost'
    ) {
      this.phoneAudioStream = stream;
      void this.audio.selectPhone(stream, info);
    } else if (
      eng.deviceLabel !== info.label ||
      eng.channelCount !== info.channels ||
      eng.processingNotDisabled.join() !== info.processingNotDisabled.join()
    ) {
      this.audio.updatePhoneInfo(info);
    }
  }

  get admittedSource() {
    return this.state.session?.sources.find((s) => s.status === 'admitted') ?? null;
  }

  async attach(session: SessionSnapshot): Promise<void> {
    this.set({ session, lifecycle: session.lifecycle });
    try {
      this.set({ stopPending: sessionStorage.getItem(`rs.stop.${session.id}`) === '1' });
    } catch {
      /* storage can be unavailable */
    }
    this.set({ resumeNeeded: this.isLive && !this.whip && !this.state.stopPending });
    this.compositor.setTheme({ serviceName: session.name });
    void this.loadTheme();
    void this.loadCalibration();
    try {
      const v = await api<{ productionSsid: string; wanBlockTestPassedAt: string | null }>(
        'GET',
        '/api/venue',
      );
      this.set({ productionSsid: v.productionSsid, wanBlockTestPassed: !!v.wanBlockTestPassedAt });
    } catch {
      /* optional */
    }
    void this.loadDestinations();
    await this.loadConfig(session.id);
    await this.renewLease();
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.leaseTimer = setInterval(() => void this.renewLease(), 10_000);
    this.socket?.close();
    this.socket = new SessionSocket(
      () => ({
        type: 'hello',
        role: 'studio',
        sessionId: session.id,
        clientId: this.clientId,
        lastSequence: this.lastSequence,
      }),
      (m) => this.onServer(m),
    );
    this.socket.onStatus = (s) => this.set({ socket: s });
  }

  private onServer(m: ServerMessage): void {
    switch (m.type) {
      case 'welcome':
      case 'snapshot':
        if (m.snapshot) {
          this.lastSequence = Math.max(this.lastSequence, m.snapshot.lastSequence);
          const hadAdmitted = this.admittedSource?.id;
          this.set({ session: m.snapshot, lifecycle: m.snapshot.lifecycle });
          this.acceptLifecycle(m.snapshot.lifecycle);
          // A reloaded tab follows the size the media node is already running at (a private test or
          // a live service started before the reload), so going live never asks for another size.
          const running = m.snapshot.runningProfile;
          if (running && running !== this.state.profile && !this.whip) this.applyProfile(running);
          if (hadAdmitted && !this.admittedSource) this.camera.close();
        }
        break;
      case 'event':
        this.lastSequence = Math.max(this.lastSequence, m.event.sequence);
        break;
      case 'observed': {
        // After a reload mid-broadcast, the observed destinations tell us which ones are live.
        const ids = m.observed ? Object.keys(m.observed.destinations) : [];
        this.set({
          observed: m.observed,
          lifecycle: m.lifecycle,
          liveDestinationIds: this.state.liveDestinationIds.length
            ? this.state.liveDestinationIds
            : ids,
        });
        this.acceptLifecycle(m.lifecycle, m.observed?.normaliser.state === 'stopped');
        break;
      }
      case 'peer':
        this.set({ cameraPresent: { ...this.state.cameraPresent, [m.sourceId]: m.present } });
        break;
      case 'signal':
        // Only the lease holder talks to the phone; a read-only tab must not answer its offers.
        if (this.state.lease?.mine && m.sourceId === this.admittedSource?.id)
          void this.camera.onSignal(m.payload);
        break;
      case 'lease.lost':
        void this.onLeaseLost();
        break;
      default:
        break;
    }
  }

  private sendSignal(payload: SignalPayload): void {
    const src = this.admittedSource;
    if (src) this.socket?.send({ type: 'signal', sourceId: src.id, payload });
  }

  /** The compositor cuts to the slate by itself when the camera stops (B§17): show that in the scenes. */
  private onCompositor(): void {
    if (this.compositor.snapshot.autoCutAt && this.state.scene !== 'slate') {
      this.set({ scene: 'slate', onAirIndex: null });
      void this.logEvent('camera.auto_slate');
    }
    this.syncTally();
  }

  private lastTally: TallyState | null = null;
  private syncTally(): void {
    const onProgramme = this.state.scene === 'camera' || this.state.scene === 'camera_lower_third';
    const connected = this.camera.snapshot.connection === 'connected';
    const tally: TallyState = !connected ? 'off' : onProgramme ? 'live' : 'ready';
    if (tally === this.lastTally || !this.state.lease?.mine) return;
    this.lastTally = tally;
    this.camera.setTally(tally);
    const src = this.admittedSource;
    if (src) this.socket?.send({ type: 'tally', sourceId: src.id, state: tally });
  }

  // ---- pairing ----
  async createInvitation(): Promise<void> {
    const s = this.state.session;
    if (!s) return;
    this.set({
      invitation: await api<CreatePairingResponse>('POST', `/api/sessions/${s.id}/pairings`),
    });
  }
  /** Ask the phone to open a fresh connection (after "Camera can't reach this laptop directly"). */
  async retryCamera(): Promise<void> {
    const s = this.state.session;
    if (!s) return;
    await api('POST', `/api/sessions/${s.id}/camera/retry`);
  }
  async admit(sourceId: string): Promise<void> {
    await api('POST', `/api/sessions/${this.state.session!.id}/sources/${sourceId}/admit`);
    this.set({ invitation: null });
  }
  async reject(sourceId: string): Promise<void> {
    await api('POST', `/api/sessions/${this.state.session!.id}/sources/${sourceId}/reject`);
  }
  async revoke(sourceId: string): Promise<void> {
    this.camera.close();
    await api('DELETE', `/api/sessions/${this.state.session!.id}/sources/${sourceId}`);
  }

  // ---- programme ----
  setProfile(profile: Profile): void {
    if (this.state.contribution !== 'idle' && this.state.contribution !== 'error') return; // fixed while sending (B§14.3)
    if (this.state.session?.runningProfile) return; // the media node is running at its own size
    this.applyProfile(profile);
  }

  private applyProfile(profile: Profile): void {
    if (profile === this.state.profile) return;
    const { w, h } = PROFILE_SIZE[profile];
    const scene = this.compositor.snapshot.scene;
    this.compositor.dispose();
    this.compositor = new Compositor(w, h);
    this.compositor.setTheme({ ...this.theme, serviceName: this.state.session?.name ?? '' });
    this.compositor.setCamera(this.camera.video);
    this.compositor.subscribe(() => this.onCompositor());
    void this.compositor.applyScene(scene);
    this.set({ profile });
  }

  /** SPEC §10.3: a card that does not fit at the smallest size is never put on air. */
  private textFits(item: Extract<RundownItem, { type: 'text' }>): boolean {
    const ok = textCardFits(textOf(item), FONT_FAMILY[this.state.churchTheme?.font ?? 'inter']);
    if (!ok) this.set({ commandError: t('rundown.textTooLong') });
    return ok;
  }

  // ---- lip-sync calibration (SPEC §11.4, SYNC-03/04) ----
  /** What a calibration is valid for: camera, received picture, audio input, routing and profile. */
  syncFingerprint(): SyncFingerprint {
    const cam = this.camera.snapshot.summary;
    const a = this.audio.snapshot;
    return {
      source: `${this.admittedSource?.label ?? 'none'}|${cam?.height ?? 0}p|${cam?.codec ?? '-'}`,
      audioDeviceLabel: a.deviceLabel ?? '',
      audioMapping: a.mode,
      profile: this.state.profile,
    };
  }

  async loadCalibration(): Promise<void> {
    const c = await api<SyncCalibration | null>('GET', '/api/calibrations/latest').catch(
      () => null,
    );
    this.set({ calibration: c });
  }

  /** Calibrated for exactly this setup, or "Recheck recommended" (SYNC-04, A18, A20). */
  syncStatus(): 'none' | 'ok' | 'recheck' {
    const c = this.state.calibration;
    if (!c) return 'none';
    if (this.state.syncRecheck) return 'recheck';
    const f = this.syncFingerprint();
    const same =
      c.sourceFingerprint === f.source &&
      c.audioDeviceLabel === f.audioDeviceLabel &&
      c.audioMapping === f.audioMapping &&
      c.profile === f.profile &&
      c.offsetMs === this.audio.snapshot.delayMs;
    return same ? 'ok' : 'recheck';
  }

  markSyncRecheck(reason: string): void {
    if (this.state.calibration) this.set({ syncRecheck: reason });
  }

  async saveCalibration(
    measuredOffsetMs: number | null,
    result: 'ok' | 'audio_late',
  ): Promise<void> {
    const s = this.state.session;
    if (!s) return;
    const f = this.syncFingerprint();
    const body = {
      sourceFingerprint: f.source,
      audioMapping: f.audioMapping,
      audioDeviceLabel: f.audioDeviceLabel,
      profile: f.profile,
      appVersion: APP_VERSION,
      offsetMs: this.audio.snapshot.delayMs,
      measuredOffsetMs,
      result,
    };
    const r = await api<{ id: string; measuredAt: string }>(
      'POST',
      `/api/sessions/${s.id}/calibrations`,
      body,
    );
    if (result === 'ok')
      this.set({
        calibration: {
          sourceFingerprint: f.source,
          audioMapping: f.audioMapping,
          audioDeviceLabel: f.audioDeviceLabel,
          profile: f.profile,
          offsetMs: body.offsetMs,
          measuredAt: r.measuredAt,
        },
        syncRecheck: null,
      });
  }

  /** The outgoing programme (after the audio delay), for the test clip. */
  programmeStream(): MediaStream {
    return new MediaStream([this.compositor.track, this.audio.track]);
  }

  // ---- church theme and images (SPEC §10.5–10.6) ----
  private theme: Partial<ProgrammeTheme> = {};

  /** Load (or reload, after Settings saves it) the church theme into the programme. */
  async loadTheme(): Promise<void> {
    try {
      const theme = await api<Theme>('GET', '/api/theme');
      this.theme = await programmeTheme(theme);
      this.set({ churchTheme: theme });
      this.compositor.setTheme({ ...this.theme, serviceName: this.state.session?.name ?? '' });
    } catch {
      /* keep the default look */
    }
  }

  /** Decode rundown images from their uploaded assets. */
  private async loadImages(): Promise<void> {
    const pending = this.state.rundown.filter(
      (i): i is Extract<RundownItem, { type: 'image' }> =>
        i.type === 'image' && !!i.assetId && !i.bitmap,
    );
    for (const item of pending) {
      const bitmap = await assetBitmap(item.assetId);
      if (!bitmap) continue;
      this.bitmaps.set(item.id, bitmap);
      this.set({
        rundown: this.state.rundown.map((x) => (x.id === item.id ? { ...item, bitmap } : x)),
      });
    }
  }

  async setFraming(framing: 'contain' | 'fill'): Promise<void> {
    this.set({ framing });
    await this.compositor.applyScene({ framing });
  }

  async cut(kind: SceneKind): Promise<void> {
    const r = this.state.rundown;
    if (kind === 'camera_lower_third') {
      const i = this.state.lastLowerThird ?? r.findIndex((x) => x.type === 'lower_third');
      const item = r[i];
      if (!item || item.type !== 'lower_third') return;
      await this.compositor.applyScene({
        kind,
        lowerThird: { line1: item.line1, line2: item.line2 },
      });
      this.set({ scene: kind, onAirIndex: i, lastLowerThird: i });
    } else if (kind === 'text') {
      const i = this.state.lastText ?? r.findIndex((x) => x.type === 'text');
      const item = r[i];
      if (!item || item.type !== 'text') return;
      if (!this.textFits(item)) return;
      await this.compositor.applyScene({ kind, text: textOf(item) });
      this.set({ scene: kind, onAirIndex: i, lastText: i });
    } else {
      await this.compositor.applyScene({ kind });
      this.set({
        scene: kind,
        onAirIndex: kind === 'camera' || kind === 'slate' ? null : this.state.onAirIndex,
      });
    }
    this.syncTally();
  }

  nextIndex(): number | null {
    const n = this.state.rundown.length;
    if (n === 0) return null;
    const i = this.state.onAirIndex === null ? 0 : this.state.onAirIndex + 1;
    return i < n ? i : null;
  }

  /** Take next: put the next prepared rundown item on air; resolves after the programme drew it. */
  async takeNext(): Promise<void> {
    const i = this.nextIndex();
    if (i === null) return;
    await this.takeItem(i);
  }

  async takeItem(i: number): Promise<void> {
    const item = this.state.rundown[i];
    if (!item) return;
    if (item.type === 'lower_third') {
      await this.compositor.applyScene({
        kind: 'camera_lower_third',
        lowerThird: { line1: item.line1, line2: item.line2 },
      });
      this.set({ scene: 'camera_lower_third', onAirIndex: i, lastLowerThird: i });
    } else if (item.type === 'text') {
      if (!this.textFits(item)) return;
      await this.compositor.applyScene({ kind: 'text', text: textOf(item) });
      this.set({ scene: 'text', onAirIndex: i, lastText: i });
    } else {
      if (!item.bitmap) return;
      await this.compositor.applyScene({ kind: 'image', image: item.bitmap, imageFit: item.fit });
      this.set({ scene: 'image', onAirIndex: i });
    }
    this.syncTally();
  }

  /** Rundown edits save to this service on the server (debounced); images stay in this tab. */
  setRundown(items: RundownItem[]): void {
    for (const i of items) if (i.type === 'image' && i.bitmap) this.bitmaps.set(i.id, i.bitmap);
    this.set({ rundown: items });
    if (this.rundownSave) clearTimeout(this.rundownSave);
    this.rundownSave = setTimeout(() => void this.saveRundown(false), 600);
  }

  async saveRundown(toPreset: boolean): Promise<void> {
    const s = this.state.session;
    if (!s || !this.state.lease?.mine) return;
    await api('PUT', `/api/sessions/${s.id}/rundown`, {
      items: toServerRundown(this.state.rundown),
      saveToPreset: toPreset,
    }).catch((e) => this.set({ commandError: (e as Error).message }));
  }

  private audioSettings(): SessionConfig['audio'] {
    const a = this.audio.snapshot;
    return {
      deviceLabel: a.deviceLabel,
      mode: a.mode,
      gainDb: a.gainDb,
      hpf: a.hpf,
      compressor: a.compressor,
      delayMs: a.delayMs,
    };
  }

  async saveAudio(toPreset: boolean): Promise<void> {
    const s = this.state.session;
    if (!s || !this.state.lease?.mine) return;
    await api('PUT', `/api/sessions/${s.id}/audio`, {
      settings: this.audioSettings(),
      saveToPreset: toPreset,
    }).catch((e) => this.set({ commandError: (e as Error).message }));
  }

  private async loadConfig(sessionId: string): Promise<void> {
    try {
      const c = await api<SessionConfig>('GET', `/api/sessions/${sessionId}/config`);
      this.set({
        presetId: c.presetId,
        presetName: c.presetName,
        rundown: fromServerRundown(c.rundown, this.bitmaps),
        savedAudioDevice: c.audio.deviceLabel ?? null,
        ...(c.destinationIds.length ? { selectedDestinationIds: c.destinationIds } : {}),
        ...(c.uplinkTest
          ? {
              uplink: {
                status: 'done' as const,
                progressMbps: c.uplinkTest.httpMbps,
                result: c.uplinkTest,
              },
            }
          : {}),
      });
      void this.loadImages();
      if (c.profile !== this.state.profile) this.setProfile(c.profile);
      this.applyAudio(c.audio);
    } catch {
      /* keep defaults */
    }
  }

  /** Restore saved audio settings; routing waits until a device with enough channels is open. */
  private applyAudio(a: SessionConfig['audio']): void {
    if (a.gainDb !== undefined) this.audio.setGainDb(a.gainDb);
    if (a.hpf !== undefined) this.audio.setHpf(a.hpf);
    if (a.compressor !== undefined) this.audio.setCompressor(a.compressor);
    if (a.delayMs !== undefined) this.audio.setDelayMs(a.delayMs);
    this.pendingAudio = a;
    if (!this.audioWatch) {
      this.audioWatch = this.audio.subscribe(() => {
        const st = this.audio.snapshot;
        if (
          st.status === 'running' &&
          this.pendingAudio?.mode &&
          st.availableModes.includes(this.pendingAudio.mode)
        ) {
          const mode = this.pendingAudio.mode;
          this.pendingAudio = null;
          if (st.mode !== mode) this.audio.setMode(mode);
        }
        const key = JSON.stringify(this.audioSettings());
        if (key !== this.lastAudioKey) {
          this.lastAudioKey = key;
          if (this.audioSave) clearTimeout(this.audioSave);
          this.audioSave = setTimeout(() => void this.saveAudio(false), 800);
        }
      });
      this.lastAudioKey = JSON.stringify(this.audioSettings());
    }
  }
  private audioWatch: (() => void) | null = null;
  private lastAudioKey = '';

  // ---- studio lease (SPEC §9.10, §17.3) ----
  private async renewLease(): Promise<void> {
    const s = this.state.session;
    if (!s) return;
    try {
      const l = await api<{
        mine: boolean;
        holderName: string | null;
        holderIsMe: boolean;
        canTakeOver: boolean;
        generation: number;
      }>('POST', `/api/sessions/${s.id}/lease`);
      const wasMine = this.state.lease?.mine;
      this.set({
        lease: {
          mine: l.mine,
          holderName: l.holderName,
          holderIsMe: l.holderIsMe,
          canTakeOver: l.canTakeOver,
        },
      });
      if (wasMine && !l.mine) void this.onLeaseLost();
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) this.set({ lease: null });
    }
  }

  /** Another tab took over: stop contributing and drop the phone link immediately (fencing, A33). */
  private async onLeaseLost(): Promise<void> {
    this.contributionWanted = false;
    ++this.contributionEpoch;
    this.set({
      lease: {
        mine: false,
        holderName: this.state.lease?.holderName ?? null,
        holderIsMe: this.state.lease?.holderIsMe ?? false,
        canTakeOver: false,
      },
    });
    await this.whip?.stop();
    this.whip = null;
    this.camera.close();
    this.set({ contribution: 'idle', sendingSince: null });
    await this.renewLease();
  }

  /** Take over the studio (confirmation in the UI). The phone renegotiates with this tab. */
  async takeOver(): Promise<void> {
    const s = this.state.session;
    if (!s) return;
    try {
      await api('POST', `/api/sessions/${s.id}/takeover`);
      const snap = await api<SessionSnapshot>('GET', `/api/sessions/${s.id}`);
      this.set({
        session: snap,
        lease: { mine: true, holderName: null, holderIsMe: true, canTakeOver: true },
      });
      await this.renewLease();
      // A new tab must check its local audio source before contributing on the new generation.
      if (this.isLive && !this.state.stopPending) this.set({ resumeNeeded: true });
    } catch (e) {
      this.set({ commandError: (e as Error).message });
    }
  }

  // ---- media node (SPEC §12): contribution + normaliser + publishers ----
  async loadDestinations(): Promise<void> {
    try {
      const destinations = await api<DestinationSummary[]>('GET', '/api/destinations');
      const ids = destinations.map((d) => d.id);
      const known = new Set(this.state.destinations.map((d) => d.id));
      const kept = this.state.selectedDestinationIds.filter((id) => ids.includes(id));
      // Newly added destinations start ticked, unless the operator has already chosen for this service.
      const added = this.selectionTouched
        ? []
        : ids.filter((id) => !known.has(id) && !kept.includes(id));
      this.set({ destinations, selectedDestinationIds: [...kept, ...added] });
      await this.loadSessionDestinations();
    } catch {
      /* shown as none configured */
    }
  }

  async loadSessionDestinations(): Promise<void> {
    const s = this.state.session;
    if (!s) return;
    const sessionDestinations = await api<SessionDestination[]>(
      'GET',
      `/api/sessions/${s.id}/destinations`,
    ).catch(() => this.state.sessionDestinations);
    this.set({ sessionDestinations });
  }

  private selectionTouched = false;
  toggleDestination(id: string): void {
    this.selectionTouched = true;
    const cur = this.state.selectedDestinationIds;
    this.set({
      selectedDestinationIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    });
  }

  /** A destination can start: persistent key saved, or this service's key pasted (B§16.4). */
  destinationHasKey(d: DestinationSummary): boolean {
    return d.keyMode === 'per_event'
      ? !!this.state.sessionDestinations.find((x) => x.destinationId === d.id)?.sessionKeyPresent
      : !!d.keyLast4;
  }

  /** Paste Facebook's key for this service (I-13). Returns whether it matches last week's ending. */
  async pasteSessionKey(destinationId: string, key: string): Promise<{ sameAsLast: boolean }> {
    const r = await api<{ keyLast4: string; sameAsLast: boolean }>(
      'PUT',
      `/api/sessions/${this.state.session!.id}/destinations/${destinationId}/key`,
      { key },
    );
    await this.loadSessionDestinations();
    return { sameAsLast: r.sameAsLast };
  }

  reportError(e: unknown): void {
    this.set({ commandError: e instanceof Error ? e.message : String(e) });
  }

  /** "I've checked the platform playback" (SPEC §13.4). */
  async confirmLive(destinationId: string): Promise<void> {
    await this.command(`destinations/${destinationId}/confirm`).catch((e) =>
      this.set({ commandError: (e as Error).message }),
    );
    await this.loadSessionDestinations();
  }

  /**
   * Uplink test (SPEC §11.3): up to 40 MB of random bytes in 4 parallel uploads for up to 20 s; the
   * server counts what arrives. Never while sending (E31).
   */
  async runUplinkTest(): Promise<void> {
    const s = this.state.session;
    if (!s || this.isLive || this.state.contribution === 'sending') return;
    this.set({ uplink: { ...this.state.uplink, status: 'running', progressMbps: null } });
    const chunk = new Uint8Array(2 * 1024 * 1024);
    for (let i = 0; i < chunk.length; i += 65536)
      crypto.getRandomValues(chunk.subarray(i, i + 65536));
    const started = performance.now();
    const deadline = started + 20_000;
    let acked = 0;
    let budget = 40 * 1024 * 1024;
    const worker = async () => {
      while (performance.now() < deadline && budget > 0) {
        budget -= chunk.length;
        const r = await fetch('/api/uplink-test/sink', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-rs-uplink',
            'X-RS-CSRF': getCsrf(),
            'X-RS-Client': clientId,
          },
          body: chunk,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        acked += ((await r.json()) as { bytes: number }).bytes;
        const secs = (performance.now() - started) / 1000;
        this.set({ uplink: { ...this.state.uplink, progressMbps: (acked * 8) / secs / 1e6 } });
      }
    };
    try {
      await Promise.all([worker(), worker(), worker(), worker()]);
      const seconds = (performance.now() - started) / 1000;
      const httpMbps = Math.round(((acked * 8) / seconds / 1e6) * 10) / 10;
      const result: UplinkResult = {
        httpMbps,
        bytes: acked,
        seconds: Math.round(seconds * 10) / 10,
        offer: uplinkOffer(httpMbps),
        measuredAt: new Date().toISOString(),
      };
      await api('POST', `/api/sessions/${s.id}/uplink-test`, result);
      this.set({ uplink: { status: 'done', progressMbps: httpMbps, result } });
    } catch {
      this.set({ uplink: { ...this.state.uplink, status: 'error' } });
    }
  }

  get isLive(): boolean {
    return !!this.state.lifecycle && LIVE_STATES.includes(this.state.lifecycle);
  }

  private contributionWanted = false;
  private contributionEpoch = 0;
  private contributionFlight: Promise<void> | null = null;
  private reconnectAt = 0;
  private reconnectAttempts = 0;
  private disconnectedAt: number | null = null;
  private connectingAt = 0;
  private recoveryBlocked = false;
  private stopFlight = false;
  private stopRetryAt = 0;
  private stopAccepted = false;
  private startPending = false;

  /** Reconcile only this tab's authorised contribution. Destination retries are independent. */
  private recoveryTick(now = Date.now()): void {
    if (this.state.stopPending) {
      if (now >= this.stopRetryAt) void this.sendStop();
      return;
    }
    if (
      !this.contributionWanted ||
      !this.state.lease?.mine ||
      this.recoveryBlocked ||
      this.startPending
    )
      return;
    if (['STOPPING', 'ENDED', 'INTERRUPTED'].includes(this.state.lifecycle ?? '')) return;
    const status = this.whip?.snapshot.status;
    if (status === 'connected') {
      this.reconnectAttempts = 0;
      this.disconnectedAt = null;
      return;
    }
    if (status === 'reconnecting') {
      this.disconnectedAt ??= now;
      if (now - this.disconnectedAt < 10_000) return;
    }
    if (status === 'connecting' && now - this.connectingAt < 25_000) return;
    if (now >= this.reconnectAt && !this.contributionFlight) {
      this.reconnectAt = now + Math.min(15_000, 1000 * 2 ** Math.min(this.reconnectAttempts++, 4));
      void this.ensureContribution(true).catch((e) => this.reportError(e));
    }
  }

  /** A reload never guesses an audio input. Select it in Preparation, then explicitly resume. */
  async resumeContribution(): Promise<void> {
    if (!this.state.lease?.mine || this.state.stopPending || !this.isLive) return;
    if (this.state.lifecycle === 'STOPPING') return;
    if (this.audio.snapshot.status !== 'running') {
      this.set({ commandError: t('recovery.chooseAudio') });
      return;
    }
    const epoch = this.contributionEpoch;
    try {
      await this.audio.ctx.resume();
    } catch (e) {
      this.reportError(e);
      return;
    }
    if (
      epoch !== this.contributionEpoch ||
      this.state.stopPending ||
      !this.state.lease?.mine ||
      !this.isLive
    )
      return;
    this.set({ resumeNeeded: false, commandError: null });
    this.contributionWanted = true;
    this.recoveryBlocked = false;
    this.reconnectAttempts = 0;
    this.reconnectAt = 0;
    await this.ensureContribution(true).catch((e) => this.reportError(e));
  }

  private acceptLifecycle(lifecycle: SessionLifecycle | null, normaliserStopped = false): void {
    if (lifecycle === 'ENDED' || lifecycle === 'INTERRUPTED' || lifecycle === 'STOPPING') {
      void this.cancelContribution();
      this.set({ resumeNeeded: false });
    }
    if (
      lifecycle === 'ENDED' ||
      lifecycle === 'INTERRUPTED' ||
      (lifecycle === 'PREPARING' && normaliserStopped && this.stopAccepted)
    ) {
      this.setStopPending(false);
    }
  }

  private async cancelContribution(): Promise<void> {
    this.contributionWanted = false;
    ++this.contributionEpoch;
    const old = this.whip;
    this.whip = null;
    this.set({ contribution: 'idle', sendingSince: null });
    await old?.stop();
  }

  /** Single flight, fresh credential per retry, and fencing against Stop/takeover while awaiting I/O. */
  private ensureContribution(force = false): Promise<void> {
    if (this.contributionFlight) return this.contributionFlight;
    if (!this.contributionWanted || !this.state.lease?.mine || this.state.stopPending)
      return Promise.resolve();
    if (!force && this.whip && ['connected', 'connecting'].includes(this.whip.snapshot.status))
      return Promise.resolve();
    const epoch = this.contributionEpoch;
    const session = this.state.session!;
    const valid = () =>
      epoch === this.contributionEpoch &&
      this.contributionWanted &&
      this.state.lease?.mine &&
      !this.state.stopPending &&
      this.state.session?.id === session.id &&
      this.state.session?.generation === session.generation;
    const run = async () => {
      const old = this.whip;
      this.whip = null;
      await old?.stop();
      if (!valid()) return;
      this.set({ contribution: 'starting', contributionError: null });
      try {
        const ingest = await api<IngestResponse>('POST', `/api/sessions/${session.id}/ingest`);
        if (!valid()) return;
        const publisher = new WhipPublisher(
          this.compositor.track,
          this.audio.track,
          PROFILE_SIZE[this.state.profile].ceiling,
        );
        this.whip = publisher;
        this.connectingAt = Date.now();
        this.disconnectedAt = null;
        publisher.subscribe(() => {
          if (this.whip !== publisher || !valid()) return;
          const w = publisher.snapshot;
          if (w.status === 'connected' && this.state.contribution !== 'sending')
            this.set({
              contribution: 'sending',
              contributionError: null,
              sendingSince: Date.now(),
            });
          if (w.status === 'reconnecting') this.set({ contribution: 'starting' });
          if (w.status === 'failed') {
            this.recoveryBlocked = w.error !== 'INGEST_TIMEOUT';
            this.set({ contribution: 'error', contributionError: w.error });
          }
        });
        await publisher.start({
          whipUrl: ingest.whipUrl,
          bearer: ingest.bearer,
          iceServers: ingest.iceServers as RTCIceServer[],
          iceTransportPolicy: ingest.iceTransportPolicy ?? 'all',
        });
        if (!valid()) await publisher.stop();
      } catch (e) {
        if (!valid()) return;
        this.recoveryBlocked = e instanceof ApiFailure && e.status >= 400 && e.status < 500;
        this.set({ contribution: 'error', contributionError: (e as Error).message });
      }
    };
    this.contributionFlight = run().finally(() => {
      this.contributionFlight = null;
    });
    return this.contributionFlight;
  }

  private setStopPending(pending: boolean): void {
    this.set({ stopPending: pending });
    const id = this.state.session?.id;
    if (!id) return;
    try {
      if (pending) sessionStorage.setItem(`rs.stop.${id}`, '1');
      else sessionStorage.removeItem(`rs.stop.${id}`);
    } catch {
      /* retry remains active even if storage is unavailable */
    }
  }

  private async sendStop(): Promise<void> {
    if (this.stopFlight || this.startPending || !this.state.stopPending || !this.state.session)
      return;
    this.stopFlight = true;
    this.stopRetryAt = Date.now() + 3000;
    try {
      const result = await api<{ stopping: boolean }>(
        'POST',
        `/api/sessions/${this.state.session.id}/stop`,
      );
      this.stopAccepted = true;
      await this.cancelContribution();
      this.set({ commandError: null });
      // Private tests have no ENDED state. No running desired media means the stop is complete.
      if (!result.stopping) this.setStopPending(false);
      const session = await api<SessionSnapshot>('GET', `/api/sessions/${this.state.session.id}`);
      this.set({ session, lifecycle: session.lifecycle });
      this.acceptLifecycle(session.lifecycle);
    } catch (e) {
      this.set({ commandError: (e as Error).message });
    } finally {
      this.stopFlight = false;
    }
  }

  private async command(path: string, body?: unknown): Promise<void> {
    await api('POST', `/api/sessions/${this.state.session!.id}/${path}`, body);
  }

  async startPrivateTest(): Promise<void> {
    const s = this.state.session;
    if (!s || this.state.stopPending || this.startPending || !this.state.lease?.mine) return;
    this.startPending = true;
    this.stopAccepted = false;
    const epoch = this.contributionEpoch;
    this.contributionWanted = true;
    this.recoveryBlocked = false;
    this.set({ contribution: 'starting', contributionError: null, commandError: null });
    try {
      await this.command('mode', { mode: 'ingest_test' });
      if (epoch !== this.contributionEpoch) return;
      await this.command('start', {
        mode: 'ingest_test',
        profile: this.state.profile,
        destinationIds: [],
        record: this.state.recordTest,
      });
      await this.ensureContribution();
    } catch (e) {
      this.contributionWanted = false;
      this.set({ contribution: 'error', contributionError: (e as Error).message });
    } finally {
      this.startPending = false;
      if (this.state.stopPending) void this.sendStop();
    }
  }

  setRecordTest(on: boolean): void {
    this.set({ recordTest: on });
  }

  /** Turn the private recording on or off while the programme runs. */
  async setRecording(on: boolean): Promise<void> {
    this.set({ commandError: null });
    await this.command('record', { on }).catch((e) =>
      this.set({ commandError: (e as Error).message }),
    );
  }

  async stopPrivateTest(): Promise<void> {
    await this.stopSending();
  }

  /** Start sending to the chosen destinations (B§16.4). The idempotency key makes double clicks safe (A32). */
  async goLive(destinationIds: string[], record = false): Promise<void> {
    if (this.state.stopPending || this.startPending || !this.state.lease?.mine) return;
    this.startPending = true;
    this.stopAccepted = false;
    const epoch = this.contributionEpoch;
    this.contributionWanted = true;
    this.recoveryBlocked = false;
    this.set({ commandError: null, liveDestinationIds: destinationIds });
    try {
      if (this.state.session?.mode === 'rehearsal')
        await this.command('mode', { mode: 'ingest_test' });
      if (epoch !== this.contributionEpoch) return;
      await api('POST', `/api/sessions/${this.state.session!.id}/start`, {
        mode: 'live',
        // A running private test is upgraded in place, at the size it is running at.
        profile: this.state.session?.runningProfile ?? this.state.profile,
        destinationIds,
        record,
      });
      await this.ensureContribution();
    } catch (e) {
      this.contributionWanted = false;
      this.set({ commandError: (e as Error).message });
    } finally {
      this.startPending = false;
      if (this.state.stopPending) void this.sendStop();
    }
  }

  async stopSending(): Promise<void> {
    this.contributionWanted = false;
    ++this.contributionEpoch;
    this.set({ resumeNeeded: false });
    this.setStopPending(true);
    // Keep the existing media flowing until the server accepts Stop. Do not confuse local
    // disconnection with confirmed destination shutdown. A pending start is fenced immediately.
    await this.sendStop();
  }

  /** Keep the slate up 5 more minutes while the studio comes back (SPEC §12.5; at most 20 min). */
  async extendGrace(): Promise<void> {
    await this.command('grace/extend').catch((e) =>
      this.set({ commandError: (e as Error).message }),
    );
  }

  async retryDestination(id: string): Promise<void> {
    await this.command(`destinations/${id}/retry`).catch((e) =>
      this.set({ commandError: (e as Error).message }),
    );
  }
}

let instance: StudioRuntime | null = null;
export function studioRuntime(): StudioRuntime {
  instance ??= new StudioRuntime();
  return instance;
}
