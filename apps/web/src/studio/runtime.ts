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
} from '@raelstream/contracts';
import {
  AudioEngine,
  CameraReceiver,
  Compositor,
  Observable,
  WhipPublisher,
  type RoutingMode,
  type SceneKind,
} from '@raelstream/media-runtime';
import { api, ApiFailure, clientId } from '../lib/api.js';
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
  commandError: string | null;
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
}

export interface SessionConfig {
  presetId: string | null;
  presetName: string | null;
  destinationIds: string[];
  profile: Profile;
  fallbackGraceS: number;
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
      commandError: null,
      lease: null,
      presetId: null,
      presetName: null,
      savedAudioDevice: null,
    });
    this.audio = new AudioEngine();
    this.compositor = new Compositor(PROFILE_SIZE.reliable_hd.w, PROFILE_SIZE.reliable_hd.h);
    this.camera = new CameraReceiver(
      (payload) => this.sendSignal(payload),
      () => this.state.session?.generation ?? 1,
      () => this.state.wanBlockTestPassed,
    );
    this.compositor.setCamera(this.camera.video);
    this.compositor.subscribe(() => this.syncTally());
    this.camera.subscribe(() => this.syncTally());
  }

  get admittedSource() {
    return this.state.session?.sources.find((s) => s.status === 'admitted') ?? null;
  }

  async attach(session: SessionSnapshot): Promise<void> {
    this.set({ session });
    this.compositor.setTheme({ serviceName: session.name });
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
    if (profile === this.state.profile) return;
    const { w, h } = PROFILE_SIZE[profile];
    const scene = this.compositor.snapshot.scene;
    this.compositor.dispose();
    this.compositor = new Compositor(w, h);
    this.compositor.setTheme({ serviceName: this.state.session?.name ?? '' });
    this.compositor.setCamera(this.camera.video);
    this.compositor.subscribe(() => this.syncTally());
    void this.compositor.applyScene(scene);
    this.set({ profile });
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
      await this.compositor.applyScene({ kind, text: { title: item.title, detail: item.detail } });
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
      await this.compositor.applyScene({
        kind: 'text',
        text: { title: item.title, detail: item.detail },
      });
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
      });
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
      // If media was live, restore our contribution on the new generation.
      if (this.isLive) await this.ensureContribution();
    } catch (e) {
      this.set({ commandError: (e as Error).message });
    }
  }

  // ---- media node (SPEC §12): contribution + normaliser + publishers ----
  async loadDestinations(): Promise<void> {
    try {
      this.set({ destinations: await api<DestinationSummary[]>('GET', '/api/destinations') });
    } catch {
      /* shown as none configured */
    }
  }

  get isLive(): boolean {
    return !!this.state.lifecycle && LIVE_STATES.includes(this.state.lifecycle);
  }

  /** Ensure the WHIP contribution for the current generation is running. */
  private async ensureContribution(): Promise<void> {
    const s = this.state.session!;
    if (
      this.whip &&
      (this.whip.snapshot.status === 'connected' || this.whip.snapshot.status === 'connecting')
    )
      return;
    const ingest = await api<IngestResponse>('POST', `/api/sessions/${s.id}/ingest`);
    this.whip = new WhipPublisher(
      this.compositor.track,
      this.audio.track,
      PROFILE_SIZE[this.state.profile].ceiling,
    );
    this.whip.subscribe(() => {
      const w = this.whip!.snapshot;
      if (w.status === 'connected' && this.state.contribution !== 'sending')
        this.set({ contribution: 'sending', sendingSince: Date.now() });
      if (w.status === 'failed') this.set({ contribution: 'error', contributionError: w.error });
    });
    await this.whip.start({
      whipUrl: ingest.whipUrl,
      bearer: ingest.bearer,
      iceServers: ingest.iceServers as RTCIceServer[],
    });
  }

  private async command(path: string, body?: unknown): Promise<void> {
    await api('POST', `/api/sessions/${this.state.session!.id}/${path}`, body);
  }

  async startPrivateTest(): Promise<void> {
    const s = this.state.session;
    if (!s) return;
    this.set({ contribution: 'starting', contributionError: null, commandError: null });
    try {
      await this.command('mode', { mode: 'ingest_test' });
      await this.command('start', {
        mode: 'ingest_test',
        profile: this.state.profile,
        destinationIds: [],
      });
      await this.ensureContribution();
    } catch (e) {
      this.set({ contribution: 'error', contributionError: (e as Error).message });
    }
  }

  async stopPrivateTest(): Promise<void> {
    await this.command('stop').catch(() => undefined);
    await this.whip?.stop();
    this.whip = null;
    const s = this.state.session;
    if (s)
      await api('POST', `/api/sessions/${s.id}/mode`, { mode: 'rehearsal' }).catch(() => undefined);
    this.set({ contribution: 'idle', sendingSince: null });
  }

  /** Start sending to the chosen destinations (B§16.4). The idempotency key makes double clicks safe (A32). */
  async goLive(destinationIds: string[]): Promise<void> {
    this.set({ commandError: null, liveDestinationIds: destinationIds });
    try {
      if (this.state.session?.mode === 'rehearsal')
        await this.command('mode', { mode: 'ingest_test' });
      await api('POST', `/api/sessions/${this.state.session!.id}/start`, {
        mode: 'live',
        profile: this.state.profile,
        destinationIds,
      });
      await this.ensureContribution();
    } catch (e) {
      this.set({ commandError: (e as Error).message });
    }
  }

  async stopSending(): Promise<void> {
    await this.command('stop').catch((e) => this.set({ commandError: (e as Error).message }));
    await this.whip?.stop();
    this.whip = null;
    this.set({ contribution: 'idle', sendingSince: null });
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
