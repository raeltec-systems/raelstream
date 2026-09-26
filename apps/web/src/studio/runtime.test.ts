import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage, SessionSnapshot } from '@raelstream/contracts';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  deliver: null as ((m: ServerMessage) => void) | null,
}));
vi.mock('../lib/api.js', () => ({
  api: mocks.api,
  clientId: 'tab',
  getCsrf: () => '',
  ApiFailure: class extends Error {
    status = 403;
  },
}));
vi.mock('../lib/theme.js', () => ({
  programmeTheme: async () => ({}),
  FONT_FAMILY: {},
  assetBitmap: async () => null,
}));
vi.mock('../lib/ws.js', () => ({
  SessionSocket: class {
    constructor(_hello: unknown, handler: (m: ServerMessage) => void) {
      mocks.deliver = handler;
    }
    close() {}
    send() {}
  },
}));
vi.mock('@raelstream/media-runtime', async () => {
  const { Observable } = await import('../../../../packages/media-runtime/src/emitter.js');
  class Audio extends Observable<Record<string, unknown>> {
    ctx = { resume: vi.fn(async () => {}) };
    track = {};
    constructor() {
      super({ status: 'running', programme: { peakDb: [-20, -20] }, availableModes: [] });
    }
    setMode() {}
    setGainDb() {}
    setHpf() {}
    setCompressor() {}
    setDelayMs() {}
  }
  class Compositor extends Observable<Record<string, unknown>> {
    track = {};
    constructor() {
      super({ scene: { kind: 'slate' } });
    }
    setCamera() {}
    setTheme() {}
    dispose() {}
    async applyScene() {}
  }
  class Camera extends Observable<Record<string, unknown>> {
    video = {};
    phoneAudioWanted = false;
    constructor() {
      super({ connection: 'idle', summary: null });
    }
    close() {}
    setTally() {}
  }
  class Publisher extends Observable<{ status: string; error: string | null }> {
    static instances: Publisher[] = [];
    stop = vi.fn(async () => {
      this.set({ status: 'closed' });
    });
    start = vi.fn(async () => {
      this.set({ status: 'connected' });
    });
    constructor() {
      super({ status: 'idle', error: null });
      Publisher.instances.push(this);
    }
    change(status: string, error: string | null = null) {
      this.set({ status, error });
    }
  }
  return {
    Observable,
    AudioEngine: Audio,
    Compositor,
    CameraReceiver: Camera,
    WhipPublisher: Publisher,
    CAMERA_STEPS: [1],
    CPU_STEPS: [{}],
    UPLOAD_STEPS: { reliable_hd: [1] },
    uploadCongested: () => false,
    cameraLinkStruggling: () => false,
    StepController: class {
      steps = 1;
      index = 0;
      update() {
        return null;
      }
      reset() {}
    },
  };
});
import { StudioRuntime } from './runtime.js';
import { WhipPublisher } from '@raelstream/media-runtime';
type PublisherMock = { change: (s: string, e?: string) => void; stop: ReturnType<typeof vi.fn> };
const publishers = () => (WhipPublisher as unknown as { instances: PublisherMock[] }).instances;
const session: SessionSnapshot = {
  id: 'session',
  name: 'Sunday',
  generation: 1,
  lifecycle: 'SENDING',
  mode: 'live',
  sources: [],
  lastSequence: 0,
};
const ingest = { whipUrl: 'https://example.test/whip', bearer: 'fresh', iceServers: [] };
let storage: Map<string, string>;
function deliver(lifecycle: SessionSnapshot['lifecycle']) {
  mocks.deliver!({ type: 'snapshot', snapshot: { ...session, lifecycle } } as ServerMessage);
}
async function runtime() {
  const rt = new StudioRuntime();
  await rt.attach(session);
  return rt;
}
beforeEach(() => {
  vi.useFakeTimers();
  storage = new Map();
  publishers().length = 0;
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn() });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  mocks.api.mockReset().mockImplementation(async (_method, path) => {
    if (path.endsWith('/lease')) return { mine: true, generation: 1 };
    if (path.endsWith('/config'))
      return { rundown: [], audio: {}, destinationIds: [], profile: 'reliable_hd' };
    if (path.endsWith('/destinations')) return [];
    if (path.endsWith('/ingest')) return ingest;
    if (path.endsWith('/stop')) return { stopping: true };
    if (path === '/api/sessions/session') return session;
    return {};
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live service recovery', () => {
  it('requires explicit resume on reload and preserves the live session/destinations', async () => {
    const rt = await runtime();
    expect(rt.snapshot.resumeNeeded).toBe(true);
    expect(publishers()).toHaveLength(0);
    await rt.resumeContribution();
    expect(rt.snapshot.contribution).toBe('sending');
    expect(rt.snapshot.resumeNeeded).toBe(false);
    expect(mocks.api.mock.calls.some(([, p]) => p.endsWith('/start'))).toBe(false);
  });
  it('gets fresh credentials and retries a failed upload, without restarting destinations', async () => {
    const rt = await runtime();
    await rt.resumeContribution();
    publishers()[0]!.change('failed', 'INGEST_TIMEOUT');
    await vi.advanceTimersByTimeAsync(1000);
    expect(publishers()).toHaveLength(2);
    expect(publishers()[0]!.stop).toHaveBeenCalled();
    expect(rt.snapshot.contribution).toBe('sending');
    expect(mocks.api.mock.calls.filter(([, p]) => p.endsWith('/ingest'))).toHaveLength(2);
  });
  it('lets brief disconnections recover in place but replaces a persistently disconnected peer', async () => {
    const rt = await runtime();
    await rt.resumeContribution();
    publishers()[0]!.change('reconnecting');
    await vi.advanceTimersByTimeAsync(9000);
    expect(publishers()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(publishers()).toHaveLength(2);
  });
  it('does not loop on non-retryable ingest authentication errors', async () => {
    const rt = await runtime();
    await rt.resumeContribution();
    publishers()[0]!.change('failed', 'INGEST_AUTH');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(publishers()).toHaveLength(1);
  });
  it('retains media on a failed Stop and retries until the server confirms the end', async () => {
    const rt = await runtime();
    await rt.resumeContribution();
    const normal = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (m, p, b) => {
      if (p.endsWith('/stop')) throw new Error('offline');
      return normal(m, p, b);
    });
    await rt.stopSending();
    expect(rt.snapshot.stopPending).toBe(true);
    expect(rt.snapshot.contribution).toBe('sending');
    expect(publishers()[0]!.stop).not.toHaveBeenCalled();
    expect(storage.get('rs.stop.session')).toBe('1');
    mocks.api.mockImplementation(normal);
    await vi.advanceTimersByTimeAsync(3000);
    expect(publishers()[0]!.stop).toHaveBeenCalled();
    expect(rt.snapshot.stopPending).toBe(true);
    deliver('ENDED');
    expect(rt.snapshot.stopPending).toBe(false);
    expect(storage.has('rs.stop.session')).toBe(false);
  });
  it('restores pending Stop after reload and never offers to resume', async () => {
    storage.set('rs.stop.session', '1');
    const rt = await runtime();
    expect(rt.snapshot.stopPending).toBe(true);
    expect(rt.snapshot.resumeNeeded).toBe(false);
    await rt.resumeContribution();
    await vi.advanceTimersByTimeAsync(1000);
    expect(publishers()).toHaveLength(0);
    expect(mocks.api.mock.calls.some(([, p]) => p.endsWith('/stop'))).toBe(true);
  });
  it.each(['stop', 'lease', 'ended'])('fences delayed ingest creation on %s', async (reason) => {
    let resolve!: (r: typeof ingest) => void;
    const normal = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((m, p, b) =>
      p.endsWith('/ingest')
        ? new Promise((r) => {
            resolve = r;
          })
        : normal(m, p, b),
    );
    const rt = await runtime();
    const pending = rt.resumeContribution();
    await vi.advanceTimersByTimeAsync(1);
    if (reason === 'stop') await rt.stopSending();
    else if (reason === 'lease') mocks.deliver!({ type: 'lease.lost' } as ServerMessage);
    else deliver('ENDED');
    resolve(ingest);
    await pending;
    expect(publishers()).toHaveLength(0);
  });
  it('does not resume before an audio source is ready', async () => {
    const rt = await runtime();
    vi.spyOn(rt.audio, 'snapshot', 'get').mockReturnValue({ ...rt.audio.snapshot, status: 'idle' });
    await rt.resumeContribution();
    expect(publishers()).toHaveLength(0);
    expect(rt.snapshot.commandError).toContain('audio');
  });
  it('does not restart after a delayed audio resume completes following session end', async () => {
    const rt = await runtime();
    let finish!: () => void;
    vi.spyOn(rt.audio.ctx, 'resume').mockImplementation(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const pending = rt.resumeContribution();
    deliver('ENDED');
    finish();
    await pending;
    expect(publishers()).toHaveLength(0);
  });
  it('keeps the sending timestamp stable during periodic connected statistics updates', async () => {
    const rt = await runtime();
    await rt.resumeContribution();
    const since = rt.snapshot.sendingSince;
    await vi.advanceTimersByTimeAsync(2000);
    publishers()[0]!.change('connected');
    expect(rt.snapshot.sendingSince).toBe(since);
  });
  it('waits for a pending Start response before sending Stop and never contributes afterwards', async () => {
    const normal = mocks.api.getMockImplementation()!;
    let finish!: (r: object) => void;
    mocks.api.mockImplementation((m, p, b) =>
      p.endsWith('/start')
        ? new Promise((r) => {
            finish = r;
          })
        : normal(m, p, b),
    );
    const rt = await runtime();
    const starting = rt.goLive(['destination']);
    await rt.stopSending();
    expect(mocks.api.mock.calls.some(([, p]) => p.endsWith('/stop'))).toBe(false);
    finish({});
    await starting;
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.api.mock.calls.some(([, p]) => p.endsWith('/stop'))).toBe(true);
    expect(publishers()).toHaveLength(0);
  });
});
