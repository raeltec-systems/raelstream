import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Destination endpoint validation (SPEC §12.4, B§23.3, A41). Official ingest hosts only, rtmps only,
 * no userinfo, and resolved addresses must be public at connection time.
 */
export type Platform = 'facebook' | 'youtube';

export interface AllowEntry {
  platform: Platform;
  url: string;
}

/** WP4 re-verifies these against each platform's current UI. */
export const DEFAULT_ALLOWLIST: AllowEntry[] = [
  { platform: 'facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/' },
  { platform: 'youtube', url: 'rtmps://a.rtmps.youtube.com/live2' },
  { platform: 'youtube', url: 'rtmps://b.rtmps.youtube.com/live2?backup=1' },
];

export class DestinationError extends Error {
  constructor(
    readonly code: 'DEST_URL_NOT_ALLOWED' | 'DEST_ADDRESS_NOT_PUBLIC' | 'DEST_KEY_INVALID',
  ) {
    super(code);
  }
}

function norm(u: string): string {
  return u.replace(/\/+$/, '');
}

/** Syntax + allowlist check. `testSinks` permits rtmp://127.0.0.1 sinks for automated tests only. */
export function validateServerUrl(
  platform: Platform,
  url: string,
  allowlist: AllowEntry[] = DEFAULT_ALLOWLIST,
  testSinks = false,
): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new DestinationError('DEST_URL_NOT_ALLOWED');
  }
  if (u.username || u.password) throw new DestinationError('DEST_URL_NOT_ALLOWED');
  if (
    testSinks &&
    u.protocol === 'rtmp:' &&
    (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
  )
    return u;
  if (u.protocol !== 'rtmps:') throw new DestinationError('DEST_URL_NOT_ALLOWED');
  if (!allowlist.some((a) => a.platform === platform && norm(a.url) === norm(url)))
    throw new DestinationError('DEST_URL_NOT_ALLOWED');
  return u;
}

/** Stream keys: printable, no whitespace or URL-structural characters. */
export function validateStreamKey(key: string): string {
  const k = key.trim();
  if (k.length < 8 || k.length > 256 || !/^[A-Za-z0-9_\-.?=&]+$/.test(k))
    throw new DestinationError('DEST_KEY_INVALID');
  return k;
}

export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const x = ip.toLowerCase();
    if (
      x === '::1' ||
      x === '::' ||
      x.startsWith('fe80:') ||
      x.startsWith('fc') ||
      x.startsWith('fd') ||
      x.startsWith('ff')
    )
      return false;
    if (x.startsWith('::ffff:')) return isPublicAddress(x.slice(7));
    return true;
  }
  return false;
}

/** Resolve at spawn time and refuse private targets (DNS rebinding / SSRF). */
export async function assertPublicHost(
  url: URL,
  testSinks = false,
  resolve = lookup,
): Promise<void> {
  if (testSinks && url.protocol === 'rtmp:') return;
  const addrs = await resolve(url.hostname, { all: true });
  if (addrs.length === 0 || !addrs.every((a) => isPublicAddress(a.address)))
    throw new DestinationError('DEST_ADDRESS_NOT_PUBLIC');
}

export function publishUrl(serverUrl: string, key: string): string {
  const u = new URL(serverUrl);
  const q = u.search;
  u.search = '';
  return `${norm(u.toString())}/${key}${q}`;
}
