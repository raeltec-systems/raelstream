import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from './db.js';
import { randomToken, safeEqual, sha256 } from './crypto.js';
import { AppError } from './errors.js';
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from './passwords.js';
import { decryptSecret, encryptSecret } from './sealing.js';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from './totp.js';
import { hashRecoveryCode, newRecoveryCodes } from './recovery.js';

export type Role = 'owner' | 'operator';

export interface Principal {
  userId: string;
  name: string;
  email: string;
  role: Role;
  csrf: string;
  sessionHash: Buffer;
}

export const SESSION_COOKIE = 'rs_sid';
export const IDLE_MS = 12 * 3600_000;
export const ABSOLUTE_MS = 7 * 24 * 3600_000;
export const CHALLENGE_MS = 5 * 60_000;
export const INVITE_MS = 72 * 3600_000;
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60_000;
const LIVE_STATES = ['STARTING', 'SENDING', 'PARTIAL', 'RECOVERING', 'STOPPING'];

export interface Enrolment {
  secret: string;
  otpauthUri: string;
  recoveryCodes: string[];
}

/**
 * Accounts: email + Argon2id password + mandatory TOTP (SPEC §6.1, I-06). Browser sessions are
 * opaque cookies stored hashed; a password alone only yields a short-lived second-factor challenge.
 */
export class AuthService {
  constructor(
    private readonly db: Kysely<DB>,
    private readonly totpKey: Buffer,
  ) {}

  private async newEnrolment(
    email: string,
  ): Promise<{ enc: Buffer; codesHash: string[]; enrolment: Enrolment }> {
    const secret = newTotpSecret();
    const codes = newRecoveryCodes();
    return {
      enc: encryptSecret(this.totpKey, secret),
      codesHash: codes.map(hashRecoveryCode),
      enrolment: {
        secret: base32Encode(secret),
        otpauthUri: otpauthUri(secret, email),
        recoveryCodes: codes,
      },
    };
  }

  async createUser(input: {
    email: string;
    name: string;
    role: Role;
    password: string;
  }): Promise<{ userId: string; enrolment: Enrolment }> {
    const email = input.email.trim().toLowerCase();
    if (passwordProblem(input.password, email)) throw new AppError('PASSWORD_WEAK', 'auth');
    const e = await this.newEnrolment(email);
    try {
      const row = await this.db
        .insertInto('users')
        .values({
          email,
          display_name: input.name.trim(),
          role: input.role,
          password_hash: await hashPassword(input.password),
          totp_secret_enc: e.enc,
          recovery_codes_hash: e.codesHash,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { userId: row.id, enrolment: e.enrolment };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new AppError('EMAIL_TAKEN', 'auth');
      throw err;
    }
  }

  /** Owner recovery via the server CLI: new TOTP secret and codes, all sessions revoked. */
  async resetMfa(email: string): Promise<Enrolment> {
    const e = await this.newEnrolment(email.toLowerCase());
    const r = await this.db
      .updateTable('users')
      .set({
        totp_secret_enc: e.enc,
        totp_confirmed_at: null,
        totp_last_step: 0,
        recovery_codes_hash: e.codesHash,
        failed_logins: 0,
        locked_until: null,
      })
      .where('email', '=', email.toLowerCase())
      .returning('id')
      .executeTakeFirst();
    if (!r) throw new AppError('NOT_FOUND', 'auth');
    await this.revokeAllSessions(r.id);
    return e.enrolment;
  }

  private async challenge(userId: string, purpose: 'login' | 'enrol'): Promise<string> {
    const token = randomToken(32);
    await this.db
      .insertInto('mfa_challenges')
      .values({
        id_hash: sha256(token),
        user_id: userId,
        purpose,
        expires_at: new Date(Date.now() + CHALLENGE_MS),
      })
      .execute();
    return token;
  }

  /**
   * Step 1: password. Every failure (unknown email, wrong password, locked, disabled) returns the same
   * error and takes the same time, so the response never reveals whether an account exists.
   */
  async beginLogin(
    emailIn: string,
    password: string,
    now = new Date(),
  ): Promise<{ challenge: string }> {
    const email = emailIn.trim().toLowerCase();
    const u = await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();
    if (!u) {
      await verifyAgainstDummy(password);
      throw new AppError('AUTH_INVALID', 'auth');
    }
    const ok = await verifyPassword(password, u.password_hash);
    const locked = !!u.locked_until && u.locked_until > now;
    if (!ok || locked || u.disabled_at) {
      if (!ok && !locked) {
        const fails = u.failed_logins + 1;
        await this.db
          .updateTable('users')
          .set({
            failed_logins: fails >= LOCK_AFTER ? 0 : fails,
            locked_until: fails >= LOCK_AFTER ? new Date(now.getTime() + LOCK_MS) : u.locked_until,
          })
          .where('id', '=', u.id)
          .execute();
      }
      throw new AppError('AUTH_INVALID', 'auth');
    }
    // The failure counter is NOT reset here: only a complete sign-in (password + code) clears it,
    // so knowing the password does not allow unlimited code guesses.
    return { challenge: await this.challenge(u.id, u.totp_confirmed_at ? 'login' : 'enrol') };
  }

  /** Step 2: authenticator code or a single-use recovery code. Creates the browser session. */
  async completeMfa(
    challengeToken: string,
    input: { code?: string; recoveryCode?: string; userAgent?: string },
    now = new Date(),
  ): Promise<{ cookie: string; principal: Principal; recoveryCodesLeft: number }> {
    // Failures must COMMIT (challenge consumed, attempt counted), so they are returned, not thrown,
    // from the transaction. Otherwise a rollback would allow unlimited guesses on one challenge.
    const r = await this.db.transaction().execute(async (trx) => {
      const ch = await trx
        .updateTable('mfa_challenges')
        .set({ used_at: now })
        .where('id_hash', '=', sha256(challengeToken))
        .where('used_at', 'is', null)
        .where('expires_at', '>', now)
        .returning(['user_id', 'purpose'])
        .executeTakeFirst();
      if (!ch) return null;
      const u = await trx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', ch.user_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (u.disabled_at || !u.totp_secret_enc || (u.locked_until && u.locked_until > now))
        return null;
      const fail = async () => {
        const fails = u.failed_logins + 1;
        await trx
          .updateTable('users')
          .set(
            fails >= LOCK_AFTER
              ? { failed_logins: 0, locked_until: new Date(now.getTime() + LOCK_MS) }
              : { failed_logins: fails },
          )
          .where('id', '=', u.id)
          .execute();
        return null;
      };
      let codes = u.recovery_codes_hash;
      if (input.code) {
        const step = verifyTotp(
          decryptSecret(this.totpKey, u.totp_secret_enc),
          input.code.replace(/\s/g, ''),
          Number(u.totp_last_step),
          now.getTime(),
        );
        if (step === null) return fail(); // a wrong code counts towards the lockout
        await trx
          .updateTable('users')
          .set({
            totp_last_step: step,
            totp_confirmed_at: u.totp_confirmed_at ?? now,
            failed_logins: 0,
          })
          .where('id', '=', u.id)
          .execute();
      } else if (input.recoveryCode && ch.purpose === 'login') {
        const h = hashRecoveryCode(input.recoveryCode);
        if (!codes.includes(h)) return fail();
        codes = codes.filter((c) => c !== h);
        await trx
          .updateTable('users')
          .set({ recovery_codes_hash: codes, failed_logins: 0 })
          .where('id', '=', u.id)
          .execute();
      } else {
        return fail();
      }
      const cookie = randomToken(32);
      const csrf = randomToken(24);
      await trx
        .insertInto('auth_sessions')
        .values({
          id_hash: sha256(cookie),
          user_id: u.id,
          csrf,
          last_seen_at: now,
          expires_at: new Date(now.getTime() + ABSOLUTE_MS),
          user_agent: input.userAgent?.slice(0, 200) ?? null,
        })
        .execute();
      return {
        cookie,
        principal: {
          userId: u.id,
          name: u.display_name,
          email: u.email,
          role: u.role,
          csrf,
          sessionHash: sha256(cookie),
        },
        recoveryCodesLeft: codes.length,
      };
    });
    if (!r) throw new AppError('AUTH_INVALID', 'auth');
    return r;
  }

  /**
   * Resolve a cookie. Idle sessions expire after 12 h, except while a broadcast is live, so nobody
   * is signed out mid-service (SPEC §6.1, E35).
   */
  async fromCookie(cookie: string | undefined, now = new Date()): Promise<Principal | null> {
    if (!cookie || cookie.length > 100) return null;
    const idHash = sha256(cookie);
    const row = await this.db
      .selectFrom('auth_sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select(['s.csrf', 's.last_seen_at', 'u.id', 'u.display_name', 'u.email', 'u.role'])
      .where('s.id_hash', '=', idHash)
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', now)
      .where('u.disabled_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    const idle = now.getTime() - row.last_seen_at.getTime();
    if (idle > IDLE_MS) {
      const live = await this.db
        .selectFrom('stream_sessions')
        .select('id')
        .where('lifecycle', 'in', LIVE_STATES)
        .executeTakeFirst();
      if (!live) return null;
    }
    if (idle > 60_000)
      await this.db
        .updateTable('auth_sessions')
        .set({ last_seen_at: now })
        .where('id_hash', '=', idHash)
        .execute();
    return {
      userId: row.id,
      name: row.display_name,
      email: row.email,
      role: row.role,
      csrf: row.csrf,
      sessionHash: idHash,
    };
  }

  async logout(cookie: string | undefined): Promise<void> {
    if (!cookie) return;
    await this.db
      .updateTable('auth_sessions')
      .set({ revoked_at: new Date() })
      .where('id_hash', '=', sha256(cookie))
      .execute();
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db
      .updateTable('auth_sessions')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  // ---- operator invites (owner only) ----
  async createInvite(
    ownerId: string,
    publicOrigin: string,
    now = new Date(),
  ): Promise<{ url: string; expiresAt: string }> {
    const token = randomToken(32);
    const expiresAt = new Date(now.getTime() + INVITE_MS);
    await this.db
      .insertInto('operator_invites')
      .values({ token_hash: sha256(token), created_by: ownerId, expires_at: expiresAt })
      .execute();
    // Secret in the fragment, as for camera pairing: never sent to servers or link previewers.
    return { url: `${publicOrigin}/invite#t=${token}`, expiresAt: expiresAt.toISOString() };
  }

  async previewInvite(token: string, now = new Date()): Promise<{ invitedBy: string }> {
    const r = await this.db
      .selectFrom('operator_invites as i')
      .innerJoin('users as u', 'u.id', 'i.created_by')
      .select('u.display_name')
      .where('i.token_hash', '=', sha256(token))
      .where('i.consumed_at', 'is', null)
      .where('i.expires_at', '>', now)
      .executeTakeFirst();
    if (!r) throw new AppError('INVITE_INVALID', 'auth');
    return { invitedBy: r.display_name };
  }

  /** Accept: consume the invite atomically, create the operator, return enrolment data shown once. */
  async acceptInvite(
    token: string,
    input: { email: string; name: string; password: string },
    now = new Date(),
  ): Promise<{ challenge: string; enrolment: Enrolment }> {
    const inv = await this.db
      .updateTable('operator_invites')
      .set({ consumed_at: now })
      .where('token_hash', '=', sha256(token))
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', now)
      .returning('id')
      .executeTakeFirst();
    if (!inv) throw new AppError('INVITE_INVALID', 'auth');
    try {
      const { userId, enrolment } = await this.createUser({ ...input, role: 'operator' });
      await this.db
        .updateTable('operator_invites')
        .set({ consumed_by: userId })
        .where('id', '=', inv.id)
        .execute();
      return { challenge: await this.challenge(userId, 'enrol'), enrolment };
    } catch (e) {
      // Let the person correct their details: the invite stays usable if account creation failed.
      await this.db
        .updateTable('operator_invites')
        .set({ consumed_at: null })
        .where('id', '=', inv.id)
        .execute();
      throw e;
    }
  }

  // ---- user management (owner only) ----
  async listUsers() {
    const rows = await this.db
      .selectFrom('users')
      .select([
        'id',
        'email',
        'display_name',
        'role',
        'disabled_at',
        'totp_confirmed_at',
        'created_at',
      ])
      .orderBy('created_at')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.display_name,
      role: r.role,
      disabled: !!r.disabled_at,
      mfaConfirmed: !!r.totp_confirmed_at,
    }));
  }

  /** Disabling revokes that user's sessions; media already running continues (E36). */
  async setDisabled(actor: Principal, userId: string, disabled: boolean): Promise<void> {
    // Owners cannot disable themselves, so at least one enabled owner always remains.
    if (actor.userId === userId) throw new AppError('FORBIDDEN', 'auth');
    const target = await this.db
      .selectFrom('users')
      .select('role')
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!target) throw new AppError('NOT_FOUND', 'auth');
    await this.db
      .updateTable('users')
      .set({ disabled_at: disabled ? new Date() : null })
      .where('id', '=', userId)
      .execute();
    if (disabled) await this.revokeAllSessions(userId);
  }
}

export function cookieOptions(secure: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    maxAge: ABSOLUTE_MS / 1000,
  };
}

/**
 * Require a signed-in user (optionally a role). State-changing methods also need the same Origin and
 * the per-session CSRF header (SPEC §6.1).
 */
export function requireUser(auth: AuthService, publicOrigin: string, role?: Role) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const p = await auth.fromCookie(req.cookies[SESSION_COOKIE]);
    if (!p) throw new AppError('AUTH_REQUIRED', 'auth');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const csrf = req.headers['x-rs-csrf'];
      if (
        req.headers.origin !== publicOrigin ||
        typeof csrf !== 'string' ||
        !safeEqual(csrf, p.csrf)
      )
        throw new AppError('FORBIDDEN', 'auth');
    }
    if (role && p.role !== role) throw new AppError('FORBIDDEN', 'auth');
    (req as FastifyRequest & { principal: Principal }).principal = p;
  };
}

export function operatorOf(req: FastifyRequest): Principal {
  return (req as FastifyRequest & { principal: Principal }).principal;
}
