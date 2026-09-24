import { FrameClock } from './clock.js';
import { Observable } from './emitter.js';
import { REF_H, REF_W, drawOverlay } from './overlays.js';
import { DEFAULT_THEME, type ProgrammeTheme, type SceneState, fitRect } from './scenes.js';

export const CAMERA_STALL_MS = 2000;
export const CAMERA_HOLD_EXTRA_MS = 1000;

export interface CompositorState {
  width: number;
  height: number;
  scene: SceneState;
  appliedVersion: number;
  cameraFrames: number;
  cameraStalled: boolean;
  lastCameraFrameAt: number | null;
  /** Set when the compositor itself cut to the slate because the camera stopped (B§17). */
  autoCutAt: number | null;
}

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

/**
 * Owns the programme canvas and its single long-lived capture track (SPEC §10.2, B§11.1).
 * Everything is drawn in 1920×1080 reference coordinates and scaled to the profile size.
 */
export class Compositor extends Observable<CompositorState> {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly clock: FrameClock;
  private readonly stream: MediaStream;
  private video: RvfcVideo | null = null;
  private theme: ProgrammeTheme = DEFAULT_THEME;
  private overlay: OffscreenCanvas | null = null;
  private pendingAck: Array<{ version: number; resolve: () => void }> = [];
  private version = 0;

  constructor(width: number, height: number) {
    super({
      width,
      height,
      appliedVersion: 0,
      cameraFrames: 0,
      cameraStalled: false,
      lastCameraFrameAt: null,
      autoCutAt: null,
      scene: {
        kind: 'slate',
        lowerThird: null,
        text: null,
        image: null,
        imageFit: 'contain',
        framing: 'contain',
      },
    });
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const g = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!g) throw new Error('Canvas 2D unavailable');
    this.g = g;
    this.stream = this.canvas.captureStream(30);
    this.renderOverlay();
    this.clock = new FrameClock(30, () => this.tick());
  }

  /** The programme video track. Created once; never replaced (B§11.1). */
  get track(): MediaStreamTrack {
    return this.stream.getVideoTracks()[0]!;
  }

  setTheme(theme: Partial<ProgrammeTheme>): void {
    this.theme = { ...this.theme, ...theme };
    this.renderOverlay();
  }

  /** Attach the received camera. Frame arrival is tracked with requestVideoFrameCallback where available. */
  setCamera(video: HTMLVideoElement | null): void {
    this.video = video as RvfcVideo | null;
    this.lastDecoded = video?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    if (!video) return;
    const v = video as RvfcVideo;
    const onFrame = () => {
      if (this.video !== v) return;
      this.set({
        cameraFrames: this.state.cameraFrames + 1,
        lastCameraFrameAt: performance.now(),
        cameraStalled: false,
      });
      v.requestVideoFrameCallback?.(onFrame);
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame);
    else v.addEventListener('timeupdate', onFrame);
  }

  /**
   * Apply a scene. Resolves only after the new version has been drawn into the programme (B§11.3):
   * the UI must not show a scene as applied before this resolves.
   */
  applyScene(patch: Partial<SceneState>): Promise<number> {
    const version = ++this.version;
    this.set({
      scene: { ...this.state.scene, ...patch },
      autoCutAt: patch.kind ? null : this.state.autoCutAt,
    });
    this.renderOverlay();
    return new Promise((resolve) =>
      this.pendingAck.push({ version, resolve: () => resolve(version) }),
    );
  }

  dispose(): void {
    this.clock.dispose();
    this.track.stop();
  }

  private lastDecoded = 0;

  /**
   * requestVideoFrameCallback stops firing while the tab is hidden, although frames keep arriving and
   * drawing. The decoded-frame count keeps advancing in a hidden tab, so frame arrival is also checked
   * on every clock tick; switching tabs must never look like a dead camera.
   */
  private pollDecodedFrames(now: number): void {
    const v = this.video;
    const decoded = v?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    // Any change counts: the counter restarts when the phone reconnects with a new stream.
    if (decoded !== this.lastDecoded) {
      this.lastDecoded = decoded;
      this.set({
        cameraFrames: this.state.cameraFrames + 1,
        lastCameraFrameAt: now,
        cameraStalled: false,
      });
    }
  }

  private cameraUsable(): boolean {
    const v = this.video;
    return !!v && v.readyState >= 2 && v.videoWidth > 0;
  }

  private tick(): void {
    const now = performance.now();
    this.pollDecodedFrames(now);
    const last = this.state.lastCameraFrameAt;
    const stalled = last !== null && now - last > CAMERA_STALL_MS;
    if (stalled !== this.state.cameraStalled) this.set({ cameraStalled: stalled });
    const onCamera =
      this.state.scene.kind === 'camera' || this.state.scene.kind === 'camera_lower_third';
    if (onCamera && last !== null && now - last > CAMERA_STALL_MS + CAMERA_HOLD_EXTRA_MS) {
      // Hold last frame ≤ 1 s after the stall warning, then cut to the slate; audio continues (B§17).
      void this.applyScene({ kind: 'slate' });
      this.set({ autoCutAt: Date.now() });
    }
    this.draw();
    if (this.pendingAck.length) {
      const acks = this.pendingAck;
      this.pendingAck = [];
      for (const a of acks) a.resolve();
      this.set({ appliedVersion: this.version });
    }
  }

  private draw(): void {
    const { g } = this;
    const { width, height, scene } = this.state;
    g.setTransform(width / REF_W, 0, 0, height / REF_H, 0, 0);
    g.fillStyle = scene.kind === 'text' ? this.theme.accent : '#000';
    g.fillRect(0, 0, REF_W, REF_H);
    if ((scene.kind === 'camera' || scene.kind === 'camera_lower_third') && this.cameraUsable()) {
      const v = this.video!;
      const r = fitRect(v.videoWidth, v.videoHeight, REF_W, REF_H, scene.framing);
      g.drawImage(v, r.x, r.y, r.w, r.h);
    } else if (scene.kind === 'image' && scene.image) {
      const r = fitRect(scene.image.width, scene.image.height, REF_W, REF_H, scene.imageFit);
      g.drawImage(scene.image, r.x, r.y, r.w, r.h);
    }
    if (this.overlay) g.drawImage(this.overlay, 0, 0);
  }

  /** Pre-render static graphics once per change so each tick is at most a few drawImage calls. */
  private renderOverlay(): void {
    const o = new OffscreenCanvas(REF_W, REF_H);
    drawOverlay(o.getContext('2d')!, this.state.scene, this.theme);
    this.overlay = o;
  }
}
