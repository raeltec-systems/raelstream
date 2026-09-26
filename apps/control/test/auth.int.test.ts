import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../src/db.js';
import type { AuthService } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import { base32Decode, hotp, timeStep } from '../src/totp.js';
import {
  ORIGIN,
  PASSWORD,
  createTestUser,
  freshDb,
  nextCode,
  signIn,
  testConfig,
  type TestUser,
} from './helpers.js';

let db: Kysely<DB>;
let app: FastifyInstance;
let auth: AuthService;
let owner: TestUser;

beforeAll(async () => {
  const f = await freshDb('rs_test_auth');
  db = f.db;
  ({ app, auth } = await buildApp(testConfig(f.url), db));
  owner = await createTestUser(auth, 'owner@church.test', 'owner', 'Israel');
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const login = (email: string, password: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: ORIGIN },
    payload: { email, password },
  });
const mfa = (challenge: string, body: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/mfa',
    headers: { origin: ORIGIN },
    payload: { challenge, ...body },
  });

describe('sign-in (SPEC §6.1)', () => {
  it('needs both the password and a 6-digit code; the password alone gives no session', async () => {
    const a = await login('owner@church.test', PASSWORD);
    expect(a.statusCode).toBe(200);
    expect(a.cookies).toHaveLength(0);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(me.statusCode).toBe(401);
    const b = await mfa(a.json().challenge, { code: nextCode(owner.secret, owner.email) });
    expect(b.statusCode).toBe(200);
    expect(b.cookies[0]!.httpOnly).toBe(true);
    expect(b.cookies[0]!.sameSite).toBe('Strict');
    const m = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `rs_sid=${b.cookies[0]!.value}` },
    });
    expect(m.json()).toMatchObject({ name: 'Israel', role: 'owner' });
    // confirms the authenticator on first use
    const u = await db
      .selectFrom('users')
      .select('totp_confirmed_at')
      .where('email', '=', 'owner@church.test')
      .executeTakeFirstOrThrow();
    expect(u.totp_confirmed_at).not.toBeNull();
  });

  it('gives the same answer for an unknown email and a wrong password (no account enumeration)', async () => {
    const unknown = await login('nobody@church.test', PASSWORD);
    const wrong = await login('owner@church.test', 'wrong password entirely');
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().message).toBe(wrong.json().message);
  });

  it('refuses a reused code (replay) and a used challenge', async () => {
    const a = await login('owner@church.test', PASSWORD);
    const code = nextCode(owner.secret, owner.email);
    expect((await mfa(a.json().challenge, { code })).statusCode).toBe(200);
    expect((await mfa(a.json().challenge, { code })).statusCode).toBe(401); // challenge already used
    const a2 = await login('owner@church.test', PASSWORD);
    expect((await mfa(a2.json().challenge, { code })).statusCode).toBe(401); // same code, same step
  });

  it('a wrong code uses up the challenge and counts towards the lockout (no brute force)', async () => {
    const v = await createTestUser(auth, 'guess@church.test', 'operator');
    const a = await login(v.email, PASSWORD);
    expect((await mfa(a.json().challenge, { code: '000000' })).statusCode).toBe(401);
    // the same challenge cannot be retried, even with the right code
    expect((await mfa(a.json().challenge, { code: nextCode(v.secret, v.email) })).statusCode).toBe(
      401,
    );
    for (let i = 0; i < 4; i++) {
      const c = await login(v.email, PASSWORD);
      expect((await mfa(c.json().challenge, { code: '000000' })).statusCode).toBe(401);
    }
    const row = await db
      .selectFrom('users')
      .select('locked_until')
      .where('email', '=', v.email)
      .executeTakeFirstOrThrow();
    expect(row.locked_until!.getTime()).toBeGreaterThan(Date.now());
    expect((await login(v.email, PASSWORD)).statusCode).toBe(401);
  });

  it('accepts each recovery code once', async () => {
    const code = owner.recoveryCodes[0]!;
    const a = await login('owner@church.test', PASSWORD);
    const r = await mfa(a.json().challenge, { recoveryCode: code.toUpperCase() });
    expect(r.statusCode).toBe(200);
    expect(r.json().recoveryCodesLeft).toBe(9);
    const a2 = await login('owner@church.test', PASSWORD);
    expect((await mfa(a2.json().challenge, { recoveryCode: code })).statusCode).toBe(401);
  });

  it('locks the account for 15 minutes after 5 wrong passwords, even for the right password', async () => {
    const victim = await createTestUser(auth, 'locked@church.test', 'operator');
    for (let i = 0; i < 5; i++)
      expect((await login(victim.email, 'not the password')).statusCode).toBe(401);
    expect((await login(victim.email, PASSWORD)).statusCode).toBe(401);
    await db
      .updateTable('users')
      .set({ locked_until: new Date(Date.now() - 1000) })
      .where('email', '=', victim.email)
      .execute();
    expect((await login(victim.email, PASSWORD)).statusCode).toBe(200);
  });

  it('rate-limits sign-in attempts per IP', async () => {
    const f = await freshDb('rs_test_auth_rl');
    const built = await buildApp(testConfig(f.url, { RS_LOGIN_RATE_LIMIT: '3' }), f.db);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push(
        (
          await built.app.inject({
            method: 'POST',
            url: '/api/auth/login',
            headers: { origin: ORIGIN },
            payload: { email: 'x@y.test', password: 'whatever it is' },
          })
        ).statusCode,
      );
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    await built.app.close();
    await f.db.destroy();
  });

  it('refuses sign-in from another origin (login CSRF)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.test' },
      payload: { email: owner.email, password: PASSWORD },
    });
    expect(r.statusCode).toBe(403);
  });

  it('never stores TOTP secrets or recovery codes in plaintext', async () => {
    const u = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', 'owner@church.test')
      .executeTakeFirstOrThrow();
    expect(u.totp_secret_enc!.toString('latin1')).not.toContain(
      base32Decode(owner.secret).toString('latin1'),
    );
    expect(u.recovery_codes_hash.join()).not.toContain(owner.recoveryCodes[1]!);
    expect(u.password_hash).toMatch(/^\$argon2id\$/);
  });
});

describe('sessions and sign-out', () => {
  it('signs out and the cookie stops working', async () => {
    const s = await signIn(app, await createTestUser(auth, 'logout@church.test', 'owner'));
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/logout', headers: s.headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: s.cookieHeader },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('expires after 12 h idle, but not while a broadcast is live (E35)', async () => {
    const s = await signIn(app, await createTestUser(auth, 'idle@church.test', 'owner'));
    const old = new Date(Date.now() - 13 * 3600_000);
    await db.updateTable('auth_sessions').set({ last_seen_at: old }).execute();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: s.cookieHeader },
        })
      ).statusCode,
    ).toBe(401);
    const live = await db
      .insertInto('stream_sessions')
      .values({ name: 'Live', operator_name: 'x', lifecycle: 'SENDING' })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: s.cookieHeader },
        })
      ).statusCode,
    ).toBe(200);
    await db
      .updateTable('stream_sessions')
      .set({ lifecycle: 'ENDED' })
      .where('id', '=', live.id)
      .execute();
  });
});

describe('operator invites and roles (SPEC §6.2)', () => {
  let inviteToken: string;
  let operator: TestUser;
  let inviter: TestUser;
  beforeAll(async () => {
    inviter = await createTestUser(auth, 'inviter@church.test', 'owner', 'Israel');
  });

  it('only owners create invites; the link carries the secret in the fragment', async () => {
    const o = await signIn(app, inviter);
    const r = await app.inject({ method: 'POST', url: '/api/invites', headers: o.headers });
    expect(r.statusCode).toBe(200);
    expect(r.json().url).toMatch(new RegExp(`^${ORIGIN}/invite#t=[A-Za-z0-9_-]{43}$`));
    inviteToken = r.json().url.split('#t=')[1];
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/invites/preview',
          payload: { token: inviteToken },
        })
      ).json(),
    ).toEqual({ invitedBy: 'Israel' });
  });

  it('rejects a weak password without using up the invite', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      headers: { origin: ORIGIN },
      payload: {
        token: inviteToken,
        email: 'chanda@church.test',
        name: 'Chanda',
        password: 'short',
      },
    });
    expect(r.json().code).toBe('PASSWORD_WEAK');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/invites/preview',
          payload: { token: inviteToken },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('accepting enrols the operator: TOTP must be confirmed with a code to finish', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      headers: { origin: ORIGIN },
      payload: {
        token: inviteToken,
        email: 'Chanda@Church.test',
        name: 'Chanda',
        password: PASSWORD,
      },
    });
    expect(r.statusCode).toBe(200);
    const { challenge, enrolment } = r.json();
    expect(enrolment.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrolment.recoveryCodes).toHaveLength(10);
    operator = {
      email: 'chanda@church.test',
      secret: enrolment.secret,
      role: 'operator',
      recoveryCodes: enrolment.recoveryCodes,
    };
    // recovery codes cannot complete enrolment: the authenticator must be proven
    expect((await mfa(challenge, { recoveryCode: enrolment.recoveryCodes[0] })).statusCode).toBe(
      401,
    );
    const again = await app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      headers: { origin: ORIGIN },
      payload: { token: inviteToken, email: 'x@church.test', name: 'X', password: PASSWORD },
    });
    expect(again.json().code).toBe('INVITE_INVALID');
    const s = await signIn(app, operator);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: s.cookieHeader },
        })
      ).json().role,
    ).toBe('operator');
  });

  it('operators cannot manage users or invites', async () => {
    const s = await signIn(app, operator);
    expect(
      (await app.inject({ method: 'POST', url: '/api/invites', headers: s.headers })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/api/users', headers: s.headers })).statusCode,
    ).toBe(403);
  });

  it('disabling a user signs them out; owners cannot disable themselves', async () => {
    const opSession = await signIn(app, operator);
    const o = await signIn(app, inviter);
    const users = (
      await app.inject({ method: 'GET', url: '/api/users', headers: o.headers })
    ).json() as Array<{ id: string; email: string }>;
    const opId = users.find((u) => u.email === 'chanda@church.test')!.id;
    const ownerId = users.find((u) => u.email === 'inviter@church.test')!.id;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/users/${opId}/disable`,
          headers: o.headers,
          payload: { disabled: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: opSession.cookieHeader },
        })
      ).statusCode,
    ).toBe(401);
    expect((await login('chanda@church.test', PASSWORD)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/users/${ownerId}/disable`,
          headers: o.headers,
          payload: { disabled: true },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('owner MFA reset issues a new secret and signs the user out everywhere', async () => {
    const u = await createTestUser(auth, 'reset@church.test', 'owner');
    const s = await signIn(app, u);
    const e = await auth.resetMfa('reset@church.test');
    expect(e.secret).not.toBe(u.secret);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: s.cookieHeader },
        })
      ).statusCode,
    ).toBe(401);
    const a = await login('reset@church.test', PASSWORD);
    expect(
      (await mfa(a.json().challenge, { code: hotp(base32Decode(u.secret), timeStep() + 1) }))
        .statusCode,
    ).toBe(401);
    const a2 = await login('reset@church.test', PASSWORD);
    expect(
      (await mfa(a2.json().challenge, { code: nextCode(e.secret, 'reset-new') })).statusCode,
    ).toBe(200);
  });
});

describe('Codespaces origin rewrite (RS_EXTRA_ALLOWED_ORIGINS)', () => {
  it('accepts the rewritten origin only when configured, never in production', async () => {
    const f = await freshDb('rs_test_origins');
    const proxied = 'http://localhost:8080';
    const { app: cs, auth: csAuth } = await buildApp(
      testConfig(f.url, { RS_EXTRA_ALLOWED_ORIGINS: `${proxied}/` }),
      f.db,
    );
    await createTestUser(csAuth, 'cs@church.test', 'owner');
    const try_ = (origin: string) =>
      cs.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin },
        payload: { email: 'cs@church.test', password: PASSWORD },
      });
    expect((await try_(proxied)).statusCode).toBe(200);
    expect((await try_(ORIGIN)).statusCode).toBe(200);
    expect((await try_('https://evil.test')).statusCode).toBe(403);
    // the default configuration still refuses the rewritten origin
    expect((await login('owner@church.test', PASSWORD)).statusCode).toBe(200);
    const plain = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: proxied },
      payload: { email: 'owner@church.test', password: PASSWORD },
    });
    expect(plain.statusCode).toBe(403);
    expect(() =>
      testConfig(f.url, {
        NODE_ENV: 'production',
        RS_EXTRA_ALLOWED_ORIGINS: proxied,
        RS_TOTP_KEY: Buffer.alloc(32).toString('base64'),
      }),
    ).toThrow(/RS_EXTRA_ALLOWED_ORIGINS/);
    await cs.close();
    await f.db.destroy();
  });
});
