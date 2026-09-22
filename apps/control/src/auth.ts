import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomToken, safeEqual, sha256 } from './crypto.js';
import { AppError } from './errors.js';

export interface Operator {
  name: string;
  csrf: string;
}

export const SESSION_COOKIE = 'rs_sid';

/**
 * WP0 dev-only operator sessions (SPEC §22 WP0 step 2). Replaced by Argon2id + TOTP accounts in WP1.
 * Sessions are kept in memory, keyed by the hash of an opaque cookie value.
 */
export class DevAuth {
  private sessions = new Map<string, Operator>();

  login(name: string): { cookie: string; operator: Operator } {
    const cookie = randomToken(32);
    const operator = { name, csrf: randomToken(24) };
    this.sessions.set(sha256(cookie).toString('hex'), operator);
    return { cookie, operator };
  }

  fromCookie(cookie: string | undefined): Operator | null {
    if (!cookie) return null;
    return this.sessions.get(sha256(cookie).toString('hex')) ?? null;
  }

  logout(cookie: string | undefined): void {
    if (cookie) this.sessions.delete(sha256(cookie).toString('hex'));
  }
}

export function cookieOptions(secure: boolean) {
  return { path: '/', httpOnly: true, sameSite: 'strict' as const, secure, maxAge: 12 * 3600 };
}

/** Require an operator; for state-changing methods also require same Origin and the CSRF header (SPEC §6.1). */
export function requireOperator(auth: DevAuth, publicOrigin: string) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const op = auth.fromCookie(req.cookies[SESSION_COOKIE]);
    if (!op) throw new AppError('AUTH_REQUIRED', 'auth');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      const csrf = req.headers['x-rs-csrf'];
      if (origin !== publicOrigin || typeof csrf !== 'string' || !safeEqual(csrf, op.csrf))
        throw new AppError('FORBIDDEN', 'auth');
    }
    (req as FastifyRequest & { operator: Operator }).operator = op;
  };
}

export function operatorOf(req: FastifyRequest): Operator {
  return (req as FastifyRequest & { operator: Operator }).operator;
}
