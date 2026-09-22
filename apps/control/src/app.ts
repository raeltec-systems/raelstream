import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { z, ZodError } from 'zod';
import {
  ClaimRequest,
  CreateSessionRequest,
  PreviewRequest,
  SourceLabel,
} from '@raelstream/contracts';
import type { Kysely } from 'kysely';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { AppError } from './errors.js';
import { safeEqual } from './crypto.js';
import { DevAuth, SESSION_COOKIE, cookieOptions, operatorOf, requireOperator } from './auth.js';
import { Hub } from './hub.js';
import { RateLimiter } from './ratelimit.js';
import * as sessions from './sessions.js';
import * as pairing from './pairing.js';
import { authorizeMediaMtx, createIngest, type MediaMtxAuthRequest } from './ingest.js';
import { StartRequest } from '@raelstream/contracts';
import { idempotent, listDestinations, retryDestination, startMedia, stopMedia } from './media.js';

const Uuid = z.string().uuid();
const SessionParams = z.object({ id: Uuid });
const SourceParams = z.object({ id: Uuid, src: Uuid });

export async function buildApp(
  cfg: Config,
  db: Kysely<DB>,
): Promise<{ app: FastifyInstance; hub: Hub }> {
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
  const auth = new DevAuth();
  const hub = new Hub(db, app.log);
  const pairLimit = new RateLimiter(cfg.pairRateLimit, 60_000);
  const operator = requireOperator(auth, cfg.publicOrigin);

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
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

  app.get('/api/health', async () => ({ ok: true }));

  // ---- dev auth (WP0 only) ----
  if (cfg.devAuth) {
    app.post('/api/dev/login', async (req, reply) => {
      if (!pairLimit.allow(`login:${req.ip}`)) throw new AppError('RATE_LIMITED', 'auth', true);
      const { name, passphrase } = z
        .object({ name: z.string().trim().min(1).max(40), passphrase: z.string().max(200) })
        .parse(req.body);
      if (!safeEqual(passphrase, cfg.devPassphrase)) throw new AppError('AUTH_INVALID', 'auth');
      const { cookie: value, operator: op } = auth.login(name);
      reply.setCookie(SESSION_COOKIE, value, cookieOptions(cfg.publicOrigin.startsWith('https:')));
      return { name: op.name, csrf: op.csrf };
    });
  }
  app.get('/api/auth/me', async (req) => {
    const op = auth.fromCookie(req.cookies[SESSION_COOKIE]);
    if (!op) throw new AppError('AUTH_REQUIRED', 'auth');
    return { name: op.name, csrf: op.csrf, devAuth: cfg.devAuth };
  });

  // ---- sessions ----
  app.post('/api/sessions', { preHandler: operator }, async (req) => {
    const { name } = CreateSessionRequest.parse(req.body);
    const s = await sessions.createSession(db, name, operatorOf(req).name);
    await sessions.appendEvent(db, s.id, 'session.created', 'info', operatorOf(req).name, { name });
    return sessions.snapshot(db, s.id);
  });
  app.get('/api/sessions/active', { preHandler: operator }, async () => {
    const s = await sessions.activeSession(db);
    return s ? sessions.snapshot(db, s.id) : null;
  });
  app.get('/api/sessions/:id', { preHandler: operator }, async (req) =>
    sessions.snapshot(db, SessionParams.parse(req.params).id),
  );
  app.post('/api/sessions/:id/end', { preHandler: operator }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    const sources = await sessions.listSources(db, id);
    await sessions.endSession(db, id, 'operator');
    for (const s of sources) hub.notifyCamera(s.id, { type: 'revoke' }, true);
    hub.broadcastEvent(
      id,
      await sessions.appendEvent(db, id, 'session.ended', 'info', operatorOf(req).name),
    );
    await hub.broadcastSnapshot(id);
    return { ok: true };
  });
  app.post('/api/sessions/:id/mode', { preHandler: operator }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    const { mode } = z.object({ mode: z.enum(['rehearsal', 'ingest_test']) }).parse(req.body);
    await sessions.setMode(db, id, mode);
    hub.broadcastEvent(
      id,
      await sessions.appendEvent(db, id, 'session.mode', 'info', operatorOf(req).name, { mode }),
    );
    await hub.broadcastSnapshot(id);
    return sessions.snapshot(db, id);
  });

  // ---- pairing ----
  app.post('/api/sessions/:id/pairings', { preHandler: operator }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    await sessions.getSession(db, id);
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
    hub.broadcastEvent(
      r.sessionId,
      await sessions.appendEvent(db, r.sessionId, 'camera.pending', 'info', 'camera', {
        label: body.label,
      }),
    );
    await hub.broadcastSnapshot(r.sessionId);
    return r;
  });
  app.post('/api/sessions/:id/sources/:src/admit', { preHandler: operator }, async (req) => {
    const { id, src } = SourceParams.parse(req.params);
    const r = await pairing.admitSource(db, id, src);
    hub.notifyCamera(src, { type: 'admitted', credential: r.credential, expiresAt: r.expiresAt });
    hub.broadcastEvent(
      id,
      await sessions.appendEvent(db, id, 'camera.admitted', 'info', operatorOf(req).name, {
        sourceId: src,
      }),
    );
    await hub.broadcastSnapshot(id);
    return { ok: true };
  });
  app.post('/api/sessions/:id/sources/:src/reject', { preHandler: operator }, async (req) => {
    const { id, src } = SourceParams.parse(req.params);
    await pairing.rejectSource(db, id, src);
    hub.notifyCamera(src, { type: 'rejected' }, true);
    hub.broadcastEvent(
      id,
      await sessions.appendEvent(db, id, 'camera.rejected', 'info', operatorOf(req).name, {
        sourceId: src,
      }),
    );
    await hub.broadcastSnapshot(id);
    return { ok: true };
  });
  app.delete('/api/sessions/:id/sources/:src', { preHandler: operator }, async (req) => {
    const { id, src } = SourceParams.parse(req.params);
    await pairing.revokeSource(db, id, src);
    hub.notifyCamera(src, { type: 'revoke' }, true);
    hub.broadcastEvent(
      id,
      await sessions.appendEvent(db, id, 'camera.revoked', 'info', operatorOf(req).name, {
        sourceId: src,
      }),
    );
    await hub.broadcastSnapshot(id);
    return { ok: true };
  });
  app.patch('/api/sessions/:id/sources/:src', { preHandler: operator }, async (req) => {
    const { id, src } = SourceParams.parse(req.params);
    const { label } = z.object({ label: SourceLabel }).parse(req.body);
    await pairing.renameSource(db, id, src, label);
    await hub.broadcastSnapshot(id);
    return { ok: true };
  });

  // ---- contribution ----
  app.post('/api/sessions/:id/ingest', { preHandler: operator }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    const s = await sessions.getSession(db, id);
    if (s.mode === 'rehearsal') throw new AppError('FORBIDDEN', 'contribution');
    const r = await createIngest(db, id, s.generation, cfg.whipPublicBase);
    hub.broadcastEvent(
      id,
      await sessions.appendEvent(db, id, 'contribution.created', 'info', operatorOf(req).name, {
        generation: s.generation,
      }),
    );
    return r;
  });

  // ---- media node: start / stop / retry (SPEC §12.1, §17.1) ----
  const idemKey = (req: { headers: Record<string, unknown> }) => {
    const k = req.headers['idempotency-key'];
    return typeof k === 'string' && Uuid.safeParse(k).success ? k : undefined;
  };
  app.get('/api/destinations', { preHandler: operator }, async () => listDestinations(db));
  app.post('/api/sessions/:id/start', { preHandler: operator }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    const body = StartRequest.parse(req.body);
    const r = await idempotent(db, idemKey(req), id, 'start', async () => {
      const out = await startMedia(db, id, body);
      hub.broadcastEvent(
        id,
        await sessions.appendEvent(
          db,
          id,
          body.mode === 'live' ? 'broadcast.start' : 'ingest_test.start',
          'info',
          operatorOf(req).name,
          { destinations: body.destinationIds.length, profile: body.profile },
        ),
      );
      await hub.broadcastSnapshot(id);
      return { mode: out.desired.mode, profile: out.desired.profile };
    });
    return r;
  });
  app.post('/api/sessions/:id/stop', { preHandler: operator }, async (req) => {
    const { id } = SessionParams.parse(req.params);
    const r = await stopMedia(db, id);
    if (r.stopping)
      hub.broadcastEvent(
        id,
        await sessions.appendEvent(db, id, 'broadcast.stop', 'info', operatorOf(req).name),
      );
    return r;
  });
  app.post('/api/sessions/:id/destinations/:dest/retry', { preHandler: operator }, async (req) => {
    const { id, dest } = z.object({ id: Uuid, dest: Uuid }).parse(req.params);
    await retryDestination(db, id, dest);
    hub.broadcastEvent(
      id,
      await sessions.appendEvent(db, id, 'destination.retry', 'info', operatorOf(req).name, {
        destinationId: dest,
      }),
    );
    return { ok: true };
  });

  app.get('/api/venue', { preHandler: operator }, async () => {
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
      const originOk = req.headers.origin === cfg.publicOrigin;
      if (!originOk) return socket.close(4403, 'origin');
      hub.attach(socket, !!auth.fromCookie(req.cookies[SESSION_COOKIE]));
    });
  });

  app.addHook('onClose', async () => hub.close());
  return { app, hub };
}
