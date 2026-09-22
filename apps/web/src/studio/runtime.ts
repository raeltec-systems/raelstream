import type {
  IngestResponse,
  SessionSnapshot,
  SignalPayload,
  TallyState,
  ServerMessage,
  CreatePairingResponse,
} from '@raelstream/contracts';
import {
  AudioEngine,
  CameraReceiver,
  Compositor,
  Observable,
  WhipPublisher,
  type SceneKind,
} from '@raelstream/media-runtime';
import { api } from '../lib/api.js';
import { SessionSocket } from '../lib/ws.js';
import { loadRundown, saveRundown, type RundownItem } from './rundown.js';

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
}

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
  private clientId = crypto.randomUUID();
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
      rundown: loadRundown(),
      onAirIndex: null,
      scene: 'slate',
      lastLowerThird: null,
      lastText: null,
      wanBlockTestPassed: false,
      productionSsid: '',
      sendingSince: null,
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
          this.set({ session: m.snapshot });
          if (hadAdmitted && !this.admittedSource) this.camera.close();
        }
        break;
      case 'event':
        this.lastSequence = Math.max(this.lastSequence, m.event.sequence);
        break;
      case 'peer':
        this.set({ cameraPresent: { ...this.state.cameraPresent, [m.sourceId]: m.present } });
        break;
      case 'signal':
        if (m.sourceId === this.admittedSource?.id) void this.camera.onSignal(m.payload);
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
    if (tally === this.lastTally) return;
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

  setRundown(items: RundownItem[]): void {
    saveRundown(items);
    this.set({ rundown: items });
  }

  // ---- contribution (private ingest test in M1) ----
  async startPrivateTest(): Promise<void> {
    const s = this.state.session;
    if (!s) return;
    this.set({ contribution: 'starting', contributionError: null });
    try {
      await api('POST', `/api/sessions/${s.id}/mode`, { mode: 'ingest_test' });
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
    } catch (e) {
      this.set({ contribution: 'error', contributionError: (e as Error).message });
    }
  }

  async stopPrivateTest(): Promise<void> {
    await this.whip?.stop();
    this.whip = null;
    const s = this.state.session;
    if (s)
      await api('POST', `/api/sessions/${s.id}/mode`, { mode: 'rehearsal' }).catch(() => undefined);
    this.set({ contribution: 'idle', sendingSince: null });
  }
}

let instance: StudioRuntime | null = null;
export function studioRuntime(): StudioRuntime {
  instance ??= new StudioRuntime();
  return instance;
}
