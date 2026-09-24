import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { z, ZodError } from 'zod';
import {
  ClaimRequest,
  CreateSessionRequest,
  PreviewRequest,
  SourceLabel,
  StartRequest,
} from '@raelstream/contracts';
import type { Kysely } from 'kysely';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { AppError } from './errors.js';
import { AuthService, SESSION_COOKIE, operatorOf, requireUser } from './auth.js';
import { Hub } from './hub.js';
import { RateLimiter } from './ratelimit.js';
import * as sessions from './sessions.js';
import * as pairing from './pairing.js';
import * as presets from './presets.js';
import { authorizeMediaMtx, createIngest, type MediaMtxAuthRequest } from './ingest.js';
import { createIceProvider } from './turn.js';
import { idempotent, listDestinations, retryDestination, startMedia, stopMedia } from './media.js';
import { acquireLease, requireLease, takeover } from './leases.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerContentRoutes } from './routes/content.js';
import { registerDestinationRoutes } from './routes/destinations.js';
import { registerRecordingRoutes } from './routes/recordings.js';

const Uuid = z.string().uuid();
const SessionParams = z.object({ id: Uuid });
const SourceParams = z.object({ id: Uuid, src: Uuid });

/** Studio tab identity for lease checks (SPEC §8.4). */
function clientIdOf(req: FastifyRequest): string | undefined {
  const c = req.headers['x-rs-client'];
  return typeof c === 'string' && Uuid.safeParse(c).success ? c : undefined;
}

export async function buildApp(
  cfg: Config,
  db: Kysely<DB>,
): Promise<{ app: FastifyInstance; hub: Hub; auth: AuthService }> {
  const app = Fastify({
    logger: cfg.production
      ? {
          level: 'info',
          redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-rs-csrf"]'],
        }
      : false,
    bodyLimit: 256 * 1024,
    trustProxy: true,
  });
  const auth = new AuthService(db, cfg.totpKey);
  const hub = new Hub(db, app.log);
  const pairLimit = new RateLimiter(cfg.pairRateLimit, 60_000);
  const ice = createIceProvider(cfg.turn, app.log);
  const user = requireUser(auth, cfg.allowedOrigins);
  /** Privileged session commands: current lease holder only (SPEC §17.3). */
  const lease = (req: FastifyRequest, id: string) => requireLease(db, id, clientIdOf(req));

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({
        code: err.code,
        message: err.message,
        component: err.component,
        retryable: err.retryable,
        requestId: req.id,
      });
    }
    const fst = (err as { code?: string }).code;
    if (fst === 'FST_ERR_CTP_BODY_TOO_LARGE' || fst === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      const e = new AppError(
        fst === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'ASSET_TOO_LARGE' : 'ASSET_UNSUPPORTED',
      );
      return reply.status(e.status).send({
        code: e.code,
        message: e.message,
        component: e.component,
        retryable: false,
        requestId: req.id,
      });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        code: 'VALIDATION',
        message: 'Some details were not valid.',
        component: 'system',
        retryable: false,
        requestId: req.id,
      });
    }
    req.log.error({ err }, 'unhandled');
    return reply.status(500).send({
      code: 'INTERNAL',
      message: 'Something went wrong.',
      component: 'system',
      retryable: true,
      requestId: req.id,
    });
  });

  const ipLimited = (req: { ip: string }) => {
    if (!pairLimit.allow(req.ip)) throw new AppError('RATE_LIMITED', 'camera', true);
  };
  const event = async (
    id: string,
    kind: string,
    actor: string,
    data: Record<string, unknown> = {},
  ) => hub.broadcastEvent(id, await sessions.appendEvent(db, id, kind, 'info', actor, data));

  app.get('/api/health', async () => ({ ok: true }));
  registerAccountRoutes(app, cfg, auth);
  registerContentRoutes(app, cfg, db, auth, lease);
  registerDestinationRoutes(app, cfg, db, auth, lease);
  registerRecordingRoutes(app, cfg, auth);

  // ---- presets ----
  app.get('/api/presets', { preHandler: user }, async () => presets.listPresets(db));
  app.post('/api/presets', { preHandler: user }, async (req) =>
    presets.createPreset(db, operatorOf(req).userId, presets.PresetInput.parse(req.body)),
  );
  app.patch('/api/presets/:id', { preHandler: user }, async (req) =>
    presets.updatePreset(
      db,
      SessionParams.parse(req.params).id,
      presets.PresetInput.partial().parse(req.body),
    ),
  );
  app.post('/api/presets/:id/archive', { preHandler: user }, async (req) => {
    await presets.archivePreset(db, SessionParams.parse(req.params).id);
    return { ok: true };
  });

  // ---- sessions ----
  app.post('/api/sessions', { preHandler: user }, async (req) => {
    const p = operatorOf(req);
    const { name, presetId } = CreateSessionRequest.parse(req.body);
    const s = await sessions.createSession(db, name, p, presetId);
    await sessions.appendEvent(db, s.id, 'session.created', 'info', p.name, {
      name,
      presetId: presetId ?? null,
    });
    const clientId = clientIdOf(req);
    if (clientId) await acquireLease(db, s.id, p, clientId);
    return sessions.snapshot(db, s.id);
  });
  app.get('/api/sessions/active', { preHandler: user }, async () => {
    const s = await sessions.activeSession(db);
    return s ? sessions.snapshot(db, s.id) : null;
  });
  app.get('/api/sessions/:id', { preHandler: user }, async (req) =>
    sessions.snapshot(db, SessionParams.parse(req.params).id),
  );
  app.get('/api/sessions/:id/config', { preHandler: user }, async (req) => {
    const s = await sessions.getSession(db, SessionParams.parse(req.params).id);
    const preset = s.preset_id
      ? await db
          .selectFrom('presets')
          .select(['name', 'destination_ids'])
          .where('id', '=', s.preset_id)
          .executeTakeFirst()
      : undefined;
    return {
      presetId: s.preset_id,
      presetName: preset?.name ?? null,
      destinationIds: preset?.destination_ids ?? [],
      profile: s.profile ?? 'reliable_hd',
      fallbackGraceS: s.fallback_grace_s,
      uplinkTest: s.uplink_test ?? null,
      rundown: s.rundown,
      audio: s.audio_state,
    };
  });
  app.put('/api/sessions/:id/rundown', { preHandler: user }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    await lease(req, id);
    const { items, saveToPreset } = z
      .object({ items: presets.Rundown, saveToPreset: z.boolean().default(false) })
      .parse(req.body);
    const s = await sessions.getSession(db, id);
    await db
      .updateTable('stream_sessions')
      .set({ rundown: JSON.stringify(items) })
      .where('id', '=', id)
      .execute();
    if (saveToPreset && s.preset_id)
      await presets.updatePreset(db, s.preset_id, { rundown: items });
    return { ok: true };
  });
  app.put('/api/sessions/:id/audio', { preHandler: user }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    await lease(req, id);
    const { settings, saveToPreset } = z
      .object({ settings: presets.AudioSettings, saveToPreset: z.boolean().default(false) })
      .parse(req.body);
    const s = await sessions.getSession(db, id);
    await db
      .updateTable('stream_sessions')
      .set({ audio_state: JSON.stringify(settings) })
      .where('id', '=', id)
      .execute();
    if (saveToPreset && s.preset_id)
      await presets.updatePreset(db, s.preset_id, { audioDefaults: settings });
    return { ok: true };
  });

  // ---- studio lease / takeover (SPEC §9.10, §17.3) ----
  app.post('/api/sessions/:id/lease', { preHandler: user }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    const clientId = clientIdOf(req);
    if (!clientId) throw new AppError('VALIDATION', 'session');
    return acquireLease(db, id, operatorOf(req), clientId);
  });
  app.post('/api/sessions/:id/takeover', { preHandler: user }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    const clientId = clientIdOf(req);
    if (!clientId) throw new AppError('VALIDATION', 'session');
    const r = await takeover(db, id, operatorOf(req), clientId);
    if (r.previousClientId && r.previousClientId !== clientId)
      hub.notifyLeaseLost(id, r.previousClientId);
    hub.notifyStudioChanged(id);
    await event(id, 'studio.takeover', operatorOf(req).name, { generation: r.generation });
    await hub.broadcastSnapshot(id);
    return { generation: r.generation };
  });

  app.post('/api/sessions/:id/end', { preHandler: user }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    await lease(req, id);
    const sources = await sessions.listSources(db, id);
    await sessions.endSession(db, id, 'operator');
    for (const s of sources) hub.notifyCamera(s.id, { type: 'revoke' }, true);
    await event(id, 'session.ended', operatorOf(req).name);
    await hub.broadcastSnapshot(id);
    return { ok: true };
  });
  app.post('/api/sessions/:id/mode', { preHandler: user }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    await lease(req, id);
    const { mode } = z.object({ mode: z.enum(['rehearsal', 'ingest_test']) }).parse(req.body);
    await sessions.setMode(db, id, mode);
    await event(id, 'session.mode', operatorOf(req).name, { mode });
    await hub.broadcastSnapshot(id);
    return sessions.snapshot(db, id);
  });

  // ---- pairing ----
  app.post('/api/sessions/:id/pairings', { preHandler: user }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    await lease(req, id);
    return pairing.createInvitation(db, id, cfg.publicOrigin);
  });
  app.post('/api/pairings/preview', async (req) => {
    ipLimited(req);
    return pairing.previewInvitation(db, PreviewRequest.parse(req.body).token);
  });
  app.post('/api/pairings/claim', async (req) => {
    ipLimited(req);
    const body = ClaimRequest.parse(req.body);
    const r = await pairing.claimInvitation(db, { ...body, userAgent: req.headers['user-agent'] });
    await event(r.sessionId, 'camera.pending', 'camera', { label: body.label });
    await hub.broadcastSnapshot(r.sessionId);
    return r;
  });
  app.post('/api/sessions/:id/sources/:src/admit', { preHandler: user }, async (req) => {
    const { id, src } = SourceParams.parse(req.params);
    await lease(req, id);
    const r = await pairing.admitSource(db, id, src);
    hub.notifyCamera(src, { type: 'admitted', credential: r.credential, expiresAt: r.expiresAt });
    await event(id, 'camera.admitted', operatorOf(req).name, { sourceId: src });
    await hub.broadcastSnapshot(id);
    return { ok: true };
  });
  app.post('/api/sessions/:id/sources/:src/reject', { preHandler: user }, async (req) => {
    const { id, src } = SourceParams.parse(req.params);
    await lease(req, id);
    await pairing.rejectSource(db, id, src);
    hub.notifyCamera(src, { type: 'rejected' }, true);
    await event(id, 'camera.rejected', operatorOf(req).name, { sourceId: src });
    await hub.broadcastSnapshot(id);
    return { ok: true };
  });
  app.delete('/api/sessions/:id/sources/:src', { preHandler: user }, async (req) => {
    const { id, src } = SourceParams.parse(req.params);
    await lease(req, id);
    await pairing.revokeSource(db, id, src);
    hub.notifyCamera(src, { type: 'revoke' }, true);
    await event(id, 'camera.revoked', operatorOf(req).name, { sourceId: src });
    await hub.broadcastSnapshot(id);
    return { ok: true };
  });
  app.patch('/api/sessions/:id/sources/:src', { preHandler: user }, async (req) => {
    const { id, src } = SourceParams.parse(req.params);
    await lease(req, id);
    const { label } = z.object({ label: SourceLabel }).parse(req.body);
    await pairing.renameSource(db, id, src, label);
    await hub.broadcastSnapshot(id);
    return { ok: true };
  });

  // ---- contribution ----
  app.post('/api/sessions/:id/ingest', { preHandler: user }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    await lease(req, id);
    const s = await sessions.getSession(db, id);
    if (s.mode === 'rehearsal') throw new AppError('FORBIDDEN', 'contribution');
    const r = {
      ...(await createIngest(
        db,
        id,
        s.generation,
        cfg.whipPublicBase,
        await ice.forContribution(),
      )),
      iceTransportPolicy: cfg.iceTransportPolicy,
    };
    await event(id, 'contribution.created', operatorOf(req).name, { generation: s.generation });
    return r;
  });

  // ---- media node: start / stop / retry (SPEC §12.1, §17.1) ----
  const idemKey = (req: { headers: Record<string, unknown> }) => {
    const k = req.headers['idempotency-key'];
    return typeof k === 'string' && Uuid.safeParse(k).success ? k : undefined;
  };
  app.get('/api/destinations', { preHandler: user }, async () => listDestinations(db));
  app.post('/api/sessions/:id/start', { preHandler: user }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    await lease(req, id);
    const body = StartRequest.parse(req.body);
    return idempotent(db, idemKey(req), id, 'start', async () => {
      const out = await startMedia(db, id, body);
      await event(
        id,
        body.mode === 'live' ? 'broadcast.start' : 'ingest_test.start',
        operatorOf(req).name,
        {
          destinations: body.destinationIds.length,
          profile: body.profile,
        },
      );
      await hub.broadcastSnapshot(id);
      return { mode: out.desired.mode, profile: out.desired.profile };
    });
  });
  // Stop: the lease holder, or any owner without the lease (SPEC §17.1): stopping must never be blocked.
  app.post('/api/sessions/:id/stop', { preHandler: user }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    if (operatorOf(req).role !== 'owner') await lease(req, id);
    const r = await stopMedia(db, id);
    if (r.stopping) await event(id, 'broadcast.stop', operatorOf(req).name);
    return r;
  });
  app.post('/api/sessions/:id/destinations/:dest/retry', { preHandler: user }, async (req) => {
    const { id, dest } = z.object({ id: Uuid, dest: Uuid }).parse(req.params);
    await lease(req, id);
    await retryDestination(db, id, dest);
    await event(id, 'destination.retry', operatorOf(req).name, { destinationId: dest });
    return { ok: true };
  });

  app.get('/api/venue', { preHandler: user }, async () => {
    const v = await db.selectFrom('venue_profile').selectAll().executeTakeFirstOrThrow();
    return {
      productionSsid: v.production_ssid,
      wanBlockTestPassedAt: v.wan_block_test_passed_at?.toISOString() ?? null,
    };
  });

  // MediaMTX HTTP auth hook; reachable only on the internal network (Caddy does not route /internal).
  app.post('/internal/mediamtx/auth', async (req, reply) => {
    const ok = await authorizeMediaMtx(db, (req.body ?? {}) as MediaMtxAuthRequest, {
      user: cfg.mediamtxInternalUser,
      pass: cfg.mediamtxInternalPass,
    });
    return reply.status(ok ? 200 : 401).send();
  });

  app.register(async (scope) => {
    scope.get('/ws', { websocket: true }, (socket, req) => {
      if (!cfg.allowedOrigins.includes(req.headers.origin ?? ''))
        return socket.close(4403, 'origin');
      // Attach synchronously so no early message is lost; the principal resolves in the background.
      hub.attach(
        socket,
        auth.fromCookie(req.cookies[SESSION_COOKIE]).catch(() => null),
      );
    });
  });

  app.addHook('onClose', async () => hub.close());
  return { app, hub, auth };
}
