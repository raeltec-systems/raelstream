/**
 * TURN relay for the studio → media node contribution (SPEC §11.1, Cloudflare TURN fallback).
 *
 * Direct UDP/TCP to MediaMTX is always tried first; the relay only matters when the studio network
 * blocks it, or when the media node itself sits behind an HTTP-only proxy (the Codespaces dev setup).
 * Credentials are minted server side so the Cloudflare API token never reaches a browser.
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceProvider {
  /** ICE servers for one WHIP contribution. Never throws: an empty list means "direct only". */
  forContribution(): Promise<IceServer[]>;
}

/** 'relay' only when a relay exists: forcing it without one would make every contribution fail. */
export function transportPolicy(env: NodeJS.ProcessEnv, turn: TurnConfig): 'all' | 'relay' {
  return env.RS_ICE_TRANSPORT_POLICY === 'relay' && turn.kind !== 'none' ? 'relay' : 'all';
}

export type TurnConfig =
  | { kind: 'none' }
  | { kind: 'static'; servers: IceServer[] }
  | { kind: 'cloudflare'; keyId: string; apiToken: string };

/** Credential lifetime: longer than the longest service, so relay allocations are never refused mid-service. */
export const TURN_TTL_S = 8 * 3600;
/** Reuse one set of credentials for a while instead of calling the API for every contribution. */
const CACHE_MS = 30 * 60_000;

export function turnConfigFromEnv(env: NodeJS.ProcessEnv): TurnConfig {
  if (env.RS_TURN_CF_KEY_ID && env.RS_TURN_CF_API_TOKEN)
    return { kind: 'cloudflare', keyId: env.RS_TURN_CF_KEY_ID, apiToken: env.RS_TURN_CF_API_TOKEN };
  if (env.RS_ICE_SERVERS) {
    const parsed: unknown = JSON.parse(env.RS_ICE_SERVERS);
    if (!Array.isArray(parsed))
      throw new Error('RS_ICE_SERVERS must be a JSON array of ICE servers');
    return { kind: 'static', servers: parsed as IceServer[] };
  }
  return { kind: 'none' };
}

/**
 * Browsers time out on port 53 TURN URLs (Cloudflare documents this); dropping them keeps the non-trickle
 * WHIP offer from waiting on a candidate that never arrives.
 */
export function browserSafe(servers: IceServer[]): IceServer[] {
  return servers
    .map((s) => {
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
      return { ...s, urls };
    })
    .filter((s) => s.urls.length > 0);
}

/** Cloudflare's response is `{ iceServers: [...] }` (older API: a single object). Accept both. */
export function parseCloudflareIce(body: unknown): IceServer[] {
  const ice = (body as { iceServers?: unknown })?.iceServers;
  const list = Array.isArray(ice) ? ice : ice ? [ice] : [];
  return list.filter((s): s is IceServer => !!s && typeof s === 'object' && 'urls' in s);
}

export function createIceProvider(
  cfg: TurnConfig,
  log: { warn: (o: object, msg: string) => void } = console as never,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): IceProvider {
  if (cfg.kind === 'none') return { forContribution: async () => [] };
  if (cfg.kind === 'static') {
    const servers = browserSafe(cfg.servers);
    return { forContribution: async () => servers };
  }
  let cached: { at: number; servers: IceServer[] } | null = null;
  return {
    async forContribution() {
      if (cached && now() - cached.at < CACHE_MS) return cached.servers;
      try {
        const res = await fetchImpl(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfg.keyId)}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cfg.apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ttl: TURN_TTL_S + CACHE_MS / 1000 }),
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const servers = browserSafe(parseCloudflareIce(await res.json()));
        cached = { at: now(), servers };
        return servers;
      } catch (e) {
        // Never block a contribution on the relay: direct paths may still work.
        log.warn(
          { err: (e as Error).message },
          'TURN credentials unavailable; contribution will try direct only',
        );
        return cached?.servers ?? [];
      }
    },
  };
}
