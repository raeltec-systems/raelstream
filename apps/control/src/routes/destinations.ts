import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { DestinationInput, UplinkResult, type SessionDestination } from '@raelstream/contracts';
import {
  DEFAULT_ALLOWLIST,
  DestinationError,
  assertPublicHost,
  validateServerUrl,
  validateStreamKey,
  type Platform,
} from '@raelstream/media-node-adapter';
import { last4, seal } from '@raelstream/secrets';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { AppError } from '../errors.js';
import { operatorOf, requireUser, type AuthService } from '../auth.js';

const IdParams = z.object({ id: z.string().uuid() });
const SessionDestParams = z.object({ id: z.string().uuid(), dest: z.string().uuid() });
const KeyBody = z.object({ key: z.string().max(400) });

/** Servers the owner may pick from (no free text, SPEC §13.1); stand-ins only outside production. */
export function allowedServers(cfg: Config): Array<{ platform: Platform; url: string }> {
  return cfg.destTestSinks
    ? [
        ...DEFAULT_ALLOWLIST,
        { platform: 'facebook', url: 'rtmp://rs-test-platform:1935/watch/facebook' },
        { platform: 'youtube', url: 'rtmp://rs-test-platform:1935/watch/youtube' },
      ]
    : DEFAULT_ALLOWLIST;
}

function checkUrl(cfg: Config, platform: Platform, url: string): URL {
  try {
    return validateServerUrl(platform, url, undefined, cfg.destTestSinks);
  } catch {
    throw new AppError('DEST_URL_NOT_ALLOWED', 'destination');
  }
}

function checkKey(key: string): string {
  try {
    return validateStreamKey(key);
  } catch {
    throw new AppError('VALIDATION', 'destination');
  }
}

/**
 * Validate a destination without sending media (SPEC §13.1): allowlist, public DNS answer, then a TCP
 * (and for rtmps a TLS) handshake with the ingest host.
 */
export async function probeIngest(cfg: Config, platform: Platform, url: string): Promise<void> {
  const u = checkUrl(cfg, platform, url);
  try {
    await assertPublicHost(u, cfg.destTestSinks);
  } catch (e) {
    throw new AppError(
      e instanceof DestinationError ? 'DEST_URL_NOT_ALLOWED' : 'DEST_UNREACHABLE',
      'destination',
    );
  }
  const port = Number(u.port || (u.protocol === 'rtmps:' ? 443 : 1935));
  await new Promise<void>((resolve, reject) => {
    const sock =
      u.protocol === 'rtmps:'
        ? tlsConnect({ host: u.hostname, port, servername: u.hostname }, () => {
            sock.end();
            resolve();
          })
        : netConnect({ host: u.hostname, port }, () => {
            sock.end();
            resolve();
          });
    sock.setTimeout(5000, () => sock.destroy(new Error('timeout')));
    sock.on('error', () => reject(new AppError('DEST_UNREACHABLE', 'destination', true)));
  });
}

/** Destination management (owner) and the per-service destination state (SPEC §13). */
export function registerDestinationRoutes(
  app: FastifyInstance,
  cfg: Config,
  db: Kysely<DB>,
  auth: AuthService,
  lease: (req: FastifyRequest, sessionId: string) => Promise<void>,
): void {
  const user = requireUser(auth, cfg.allowedOrigins);
  const owner = requireUser(auth, cfg.allowedOrigins, 'owner');
  const sealKey = async (key: string) => {
    if (!cfg.sealPublicKey) throw new AppError('INTERNAL');
    return seal(cfg.sealPublicKey, key);
  };

  app.get('/api/destinations/servers', { preHandler: owner }, async () => allowedServers(cfg));

  app.post('/api/destinations', { preHandler: owner }, async (req) => {
    const d = DestinationInput.parse(req.body);
    checkUrl(cfg, d.platform, d.serverUrl);
    const key = d.key ? checkKey(d.key) : null;
    const row = await db
      .insertInto('destinations')
      .values({
        platform: d.platform,
        label: d.label,
        server_url: d.serverUrl,
        key_mode: d.keyMode,
        auto_publishes_on_ingest: d.autoPublishesOnIngest,
        watch_url: d.watchUrl,
        event_reference: d.eventReference,
        ...(key
          ? { key_enc: await sealKey(key), key_last4: last4(key), key_updated_at: new Date() }
          : {}),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: row.id };
  });

  app.patch('/api/destinations/:id', { preHandler: owner }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const d = DestinationInput.omit({ key: true }).parse(req.body);
    checkUrl(cfg, d.platform, d.serverUrl);
    const r = await db
      .updateTable('destinations')
      .set({
        platform: d.platform,
        label: d.label,
        server_url: d.serverUrl,
        key_mode: d.keyMode,
        auto_publishes_on_ingest: d.autoPublishesOnIngest,
        watch_url: d.watchUrl,
        event_reference: d.eventReference,
      })
      .where('id', '=', id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw new AppError('NOT_FOUND');
    return { ok: true };
  });

  /** Keys can be replaced, never revealed (SPEC §13.1). */
  app.put('/api/destinations/:id/key', { preHandler: owner }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const key = checkKey(KeyBody.parse(req.body).key);
    const r = await db
      .updateTable('destinations')
      .set({ key_enc: await sealKey(key), key_last4: last4(key), key_updated_at: new Date() })
      .where('id', '=', id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw new AppError('NOT_FOUND');
    return { keyLast4: last4(key) };
  });

  app.delete('/api/destinations/:id', { preHandler: owner }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await db
      .updateTable('destinations')
      .set({ archived_at: new Date(), key_enc: null })
      .where('id', '=', id)
      .execute();
    return { ok: true };
  });

  app.post('/api/destinations/:id/validate', { preHandler: owner }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const d = await db
      .selectFrom('destinations')
      .select(['platform', 'server_url'])
      .where('id', '=', id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!d) throw new AppError('NOT_FOUND');
    await probeIngest(cfg, d.platform as Platform, d.server_url);
    return { ok: true };
  });

  // ---- uplink test (SPEC §11.3) ----
  // The body is counted as it streams in and thrown away; nothing is stored.
  app.addContentTypeParser(
    'application/x-rs-uplink',
    { bodyLimit: 64 * 1024 * 1024 },
    (_req, payload, done) => {
      let bytes = 0;
      payload.on('data', (c: Buffer) => (bytes += c.length));
      payload.on('end', () => done(null, { bytes }));
      payload.on('error', (e) => done(e));
    },
  );
  app.post(
    '/api/uplink-test/sink',
    { preHandler: user, bodyLimit: 64 * 1024 * 1024 },
    async (req) => {
      const body = req.body as { bytes?: number } | undefined;
      return { bytes: body?.bytes ?? 0 };
    },
  );
  app.post('/api/sessions/:id/uplink-test', { preHandler: user }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await lease(req, id);
    const result = UplinkResult.parse(req.body);
    const s = await db
      .selectFrom('stream_sessions')
      .select('lifecycle')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!s) throw new AppError('NOT_FOUND');
    // Never during a broadcast (E31): the test would compete with the programme for the uplink.
    if (['STARTING', 'SENDING', 'PARTIAL', 'RECOVERING', 'STOPPING'].includes(s.lifecycle))
      throw new AppError('FORBIDDEN', 'contribution');
    await db
      .updateTable('stream_sessions')
      .set({ uplink_test: JSON.stringify(result) })
      .where('id', '=', id)
      .execute();
    return result;
  });

  // ---- per service ----
  app.get('/api/sessions/:id/destinations', { preHandler: user }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const rows = await db
      .selectFrom('session_destinations')
      .select(['destination_id', 'session_key_enc', 'session_key_last4', 'live_confirmation'])
      .where('session_id', '=', id)
      .execute();
    return rows.map((r): SessionDestination => ({
      destinationId: r.destination_id,
      sessionKeyLast4: r.session_key_last4,
      sessionKeyPresent: !!r.session_key_enc,
      liveConfirmation: r.live_confirmation
        ? { by: r.live_confirmation.by, at: r.live_confirmation.at }
        : null,
    }));
  });

  /** Facebook's key for this service (I-13): operators may paste it but never read it back. */
  app.put('/api/sessions/:id/destinations/:dest/key', { preHandler: user }, async (req) => {
    const { id, dest } = SessionDestParams.parse(req.params);
    await lease(req, id);
    const key = checkKey(KeyBody.parse(req.body).key);
    const d = await db
      .selectFrom('destinations')
      .select('key_mode')
      .where('id', '=', dest)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!d || d.key_mode !== 'per_event') throw new AppError('NOT_FOUND');
    const previous = await db
      .selectFrom('session_destinations')
      .select('session_key_last4')
      .where('destination_id', '=', dest)
      .where('session_id', '!=', id)
      .where('session_key_last4', 'is not', null)
      .orderBy('selected_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const enc = await sealKey(key);
    await db
      .insertInto('session_destinations')
      .values({
        session_id: id,
        destination_id: dest,
        session_key_enc: enc,
        session_key_last4: last4(key),
      })
      .onConflict((oc) =>
        oc
          .columns(['session_id', 'destination_id'])
          .doUpdateSet({ session_key_enc: enc, session_key_last4: last4(key) }),
      )
      .execute();
    return {
      keyLast4: last4(key),
      // "This looks like last week's key. Facebook may have issued a new one." (SPEC §13.3)
      sameAsLast: previous?.session_key_last4 === last4(key),
    };
  });

  /** "I've checked the platform playback" (SPEC §13.4). */
  app.post('/api/sessions/:id/destinations/:dest/confirm', { preHandler: user }, async (req) => {
    const { id, dest } = SessionDestParams.parse(req.params);
    await lease(req, id);
    const confirmation = {
      source: 'operator' as const,
      by: operatorOf(req).name,
      at: new Date().toISOString(),
    };
    const r = await db
      .updateTable('session_destinations')
      .set({ live_confirmation: JSON.stringify(confirmation) })
      .where('session_id', '=', id)
      .where('destination_id', '=', dest)
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw new AppError('NOT_SENDING', 'destination');
    return { by: confirmation.by, at: confirmation.at };
  });
}
