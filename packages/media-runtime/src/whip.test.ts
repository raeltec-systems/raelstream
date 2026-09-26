import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhipPublisher } from './whip.js';
vi.mock('./sdp.js', () => ({ preferCodecs() {}, waitForIceGathering: async () => {} }));
class Peer {
  static instances: Peer[] = [];
  connectionState = 'new';
  localDescription = { sdp: 'offer' };
  listener = () => {};
  close = vi.fn();
  setRemoteDescription = vi.fn(async () => {});
  constructor() {
    Peer.instances.push(this);
  }
  addTransceiver() {
    return { sender: { getParameters: () => ({}), setParameters: async () => {} } };
  }
  addEventListener(_n: string, f: () => void) {
    this.listener = f;
  }
  async createOffer() {
    return { sdp: 'offer' };
  }
  async setLocalDescription() {}
  async getStats() {
    return new Map();
  }
}
const target = { whipUrl: 'https://example.test/whip', bearer: 'fake', iceServers: [] };
const response = () => new Response('answer', { status: 201, headers: { Location: '/resource' } });
beforeEach(() => {
  vi.useFakeTimers();
  Peer.instances = [];
  vi.stubGlobal('RTCPeerConnection', Peer);
  vi.stubGlobal('MediaStream', class {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('WHIP cancellation', () => {
  it('aborts an in-flight offer on Stop and ignores late completion', async () => {
    let resolve!: (r: Response) => void;
    const fetcher = vi.fn(
      (_url, _init) =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const publisher = new WhipPublisher({} as MediaStreamTrack, {} as MediaStreamTrack, 1);
    const start = publisher.start(target);
    await vi.advanceTimersByTimeAsync(1);
    const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
    await publisher.stop();
    expect(signal.aborted).toBe(true);
    resolve(response());
    await start;
    expect(Peer.instances[0]!.setRemoteDescription).not.toHaveBeenCalled();
    expect(publisher.snapshot.status).toBe('closed');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores connection events from a replaced peer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) =>
        init.method === 'DELETE' ? new Response(null, { status: 204 }) : response(),
      ),
    );
    const publisher = new WhipPublisher({} as MediaStreamTrack, {} as MediaStreamTrack, 1);
    await publisher.start(target);
    const old = Peer.instances[0]!;
    await publisher.start(target);
    old.connectionState = 'failed';
    old.listener();
    expect(publisher.snapshot.status).toBe('connecting');
    await publisher.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
