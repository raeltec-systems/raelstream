import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { AppError } from '../errors.js';
import { RateLimiter } from '../ratelimit.js';
import {
  SESSION_COOKIE,
  cookieOptions,
  operatorOf,
  requireUser,
  type AuthService,
} from '../auth.js';

const Email = z.string().trim().toLowerCase().email().max(200);
const Token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Sign-in (password → second factor), sign-out, invites and user management (SPEC §6). */
export function registerAccountRoutes(app: FastifyInstance, cfg: Config, auth: AuthService): void {
  const loginLimit = new RateLimiter(cfg.loginRateLimit, 10 * 60_000);
  const inviteLimit = new RateLimiter(20, 10 * 60_000);
  const user = requireUser(auth, cfg.allowedOrigins);
  const owner = requireUser(auth, cfg.allowedOrigins, 'owner');
  const secure = cfg.publicOrigin.startsWith('https:');
  const sameOrigin = (origin: string | undefined) => {
    if (!cfg.allowedOrigins.includes(origin ?? '')) throw new AppError('FORBIDDEN', 'auth');
  };

  app.post('/api/auth/login', async (req) => {
    sameOrigin(req.headers.origin);
    if (!loginLimit.allow(req.ip)) throw new AppError('RATE_LIMITED', 'auth', true);
    const { email, password } = z
      .object({ email: Email, password: z.string().min(1).max(200) })
      .parse(req.body);
    return auth.beginLogin(email, password);
  });

  app.post('/api/auth/mfa', async (req, reply) => {
    sameOrigin(req.headers.origin);
    if (!loginLimit.allow(req.ip)) throw new AppError('RATE_LIMITED', 'auth', true);
    const body = z
      .object({
        challenge: Token,
        code: z.string().max(12).optional(),
        recoveryCode: z.string().max(40).optional(),
      })
      .parse(req.body);
    const r = await auth.completeMfa(body.challenge, {
      code: body.code,
      recoveryCode: body.recoveryCode,
      userAgent: req.headers['user-agent'],
    });
    reply.setCookie(SESSION_COOKIE, r.cookie, cookieOptions(secure));
    return {
      name: r.principal.name,
      role: r.principal.role,
      csrf: r.principal.csrf,
      recoveryCodesLeft: r.recoveryCodesLeft,
    };
  });

  app.post('/api/auth/logout', { preHandler: user }, async (req, reply) => {
    await auth.logout(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const p = await auth.fromCookie(req.cookies[SESSION_COOKIE]);
    if (!p) throw new AppError('AUTH_REQUIRED', 'auth');
    return { userId: p.userId, name: p.name, email: p.email, role: p.role, csrf: p.csrf };
  });

  // ---- operator invites ----
  app.post('/api/invites', { preHandler: owner }, async (req) =>
    auth.createInvite(operatorOf(req).userId, cfg.publicOrigin),
  );
  app.post('/api/invites/preview', async (req) => {
    if (!inviteLimit.allow(req.ip)) throw new AppError('RATE_LIMITED', 'auth', true);
    return auth.previewInvite(z.object({ token: Token }).parse(req.body).token);
  });
  app.post('/api/invites/accept', async (req) => {
    sameOrigin(req.headers.origin);
    if (!inviteLimit.allow(req.ip)) throw new AppError('RATE_LIMITED', 'auth', true);
    const b = z
      .object({
        token: Token,
        email: Email,
        name: z.string().trim().min(1).max(60),
        password: z.string().max(200),
      })
      .parse(req.body);
    return auth.acceptInvite(b.token, { email: b.email, name: b.name, password: b.password });
  });

  // ---- users (owner) ----
  app.get('/api/users', { preHandler: owner }, async () => auth.listUsers());
  app.post('/api/users/:id/disable', { preHandler: owner }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { disabled } = z.object({ disabled: z.boolean() }).parse(req.body);
    await auth.setDisabled(operatorOf(req), id, disabled);
    return { ok: true };
  });
}
