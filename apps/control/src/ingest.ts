import type { Kysely } from 'kysely';
import type { DB } from './db.js';
import { randomToken, safeEqual, sha256 } from './crypto.js';

export const INGEST_TTL_MS = 30 * 60_000;

export function contributionPath(sessionId: string, generation: number): string {
  return `live/${sessionId}/g${generation}/contrib`;
}

/** Scoped, short-lived WHIP credential for exactly one path (SPEC §11.1). Never carries destination keys. */
export async function createIngest(
  db: Kysely<DB>,
  sessionId: string,
  generation: number,
  whipPublicBase: string,
  now = new Date(),
) {
  const bearer = randomToken(32);
  const path = contributionPath(sessionId, generation);
  const expiresAt = new Date(now.getTime() + INGEST_TTL_MS);
  await db
    .insertInto('ingest_tokens')
    .values({
      token_hash: sha256(bearer),
      session_id: sessionId,
      generation,
      path,
      expires_at: expiresAt,
    })
    .execute();
  return {
    whipUrl: `${whipPublicBase}/${path}/whip`,
    bearer,
    expiresAt: expiresAt.toISOString(),
    iceServers: [] as { urls: string }[],
  };
}

/** Body MediaMTX POSTs to the HTTP auth hook (authMethod: http). */
export interface MediaMtxAuthRequest {
  user?: string;
  password?: string;
  token?: string;
  ip?: string;
  action?: string;
  path?: string;
  protocol?: string;
  query?: string;
}

const PRIVATE_ADDR = /^(127\.|::1$|::ffff:127\.|172\.(1[6-9]|2\d|3[01])\.|10\.)/;

/**
 * Decide a MediaMTX access request (A42): publish only with a valid token for that exact path and the
 * session's current generation; read only for internal supervisor credentials from a private address.
 */
export async function authorizeMediaMtx(
  db: Kysely<DB>,
  req: MediaMtxAuthRequest,
  internal: { user: string; pass: string },
  now = new Date(),
): Promise<boolean> {
  const action = req.action ?? '';
  if (action === 'publish') {
    const token = req.token || req.password || '';
    if (!token || !req.path) return false;
    const row = await db
      .selectFrom('ingest_tokens')
      .innerJoin('stream_sessions as s', 's.id', 'ingest_tokens.session_id')
      .select([
        'ingest_tokens.path',
        'ingest_tokens.generation',
        's.generation as current',
        's.lifecycle',
      ])
      .where('token_hash', '=', sha256(token))
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst();
    return (
      !!row &&
      row.path === req.path &&
      row.generation === row.current &&
      row.lifecycle !== 'ENDED' &&
      row.lifecycle !== 'INTERRUPTED'
    );
  }
  if (action === 'read' || action === 'playback' || action === 'api' || action === 'metrics') {
    return (
      !!req.user &&
      !!req.password &&
      safeEqual(req.user, internal.user) &&
      safeEqual(req.password, internal.pass) &&
      PRIVATE_ADDR.test(req.ip ?? '')
    );
  }
  return false;
}
