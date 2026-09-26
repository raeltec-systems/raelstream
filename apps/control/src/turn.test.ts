import { describe, expect, it, vi } from 'vitest';
import {
  browserSafe,
  createIceProvider,
  parseCloudflareIce,
  transportPolicy,
  turnConfigFromEnv,
} from './turn.js';

const CF = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'u1',
      credential: 'c1',
    },
  ],
};
const silent = { warn: () => undefined };

describe('TURN relay config', () => {
  it('prefers Cloudflare, then a static list, else none', () => {
    expect(turnConfigFromEnv({ RS_TURN_CF_KEY_ID: 'k', RS_TURN_CF_API_TOKEN: 't' })).toEqual({
      kind: 'cloudflare',
      keyId: 'k',
      apiToken: 't',
    });
    expect(turnConfigFromEnv({ RS_ICE_SERVERS: '[{"urls":"turn:x:3478"}]' }).kind).toBe('static');
    expect(turnConfigFromEnv({}).kind).toBe('none');
    expect(() => turnConfigFromEnv({ RS_ICE_SERVERS: '{}' })).toThrow();
  });

  it('forces relay only when a relay is configured', () => {
    const cf = turnConfigFromEnv({ RS_TURN_CF_KEY_ID: 'k', RS_TURN_CF_API_TOKEN: 't' });
    expect(transportPolicy({ RS_ICE_TRANSPORT_POLICY: 'relay' }, cf)).toBe('relay');
    expect(transportPolicy({ RS_ICE_TRANSPORT_POLICY: 'relay' }, { kind: 'none' })).toBe('all');
    expect(transportPolicy({}, cf)).toBe('all');
  });

  it('drops port-53 URLs that browsers time out on', () => {
    const out = browserSafe(parseCloudflareIce(CF));
    expect(out.flatMap((s) => s.urls)).toEqual([
      'stun:stun.cloudflare.com:3478',
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turns:turn.cloudflare.com:443?transport=tcp',
    ]);
    expect(out[1]).toMatchObject({ username: 'u1', credential: 'c1' });
  });

  it('accepts the older single-object response shape', () => {
    expect(
      parseCloudflareIce({ iceServers: { urls: ['turn:a:3478'], username: 'u' } }),
    ).toHaveLength(1);
    expect(parseCloudflareIce(null)).toEqual([]);
  });
});

describe('Cloudflare ICE provider', () => {
  it('mints credentials server side with the API token and caches them', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(CF), { status: 201 }));
    let t = 0;
    const p = createIceProvider(
      { kind: 'cloudflare', keyId: 'key/1', apiToken: 'secret' },
      silent,
      fetchImpl as unknown as typeof fetch,
      () => t,
    );
    const a = await p.forContribution();
    expect(a).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key%2F1/credentials/generate-ice-servers',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string).ttl).toBeGreaterThanOrEqual(8 * 3600);
    t = 10 * 60_000;
    await p.forContribution();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t = 31 * 60_000;
    await p.forContribution();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never blocks a contribution when the API fails', async () => {
    const warn = vi.fn();
    const p = createIceProvider(
      { kind: 'cloudflare', keyId: 'k', apiToken: 't' },
      { warn },
      (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
    );
    expect(await p.forContribution()).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('t"');
  });
});
