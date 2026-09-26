import pg from 'pg';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { createDb, type DB } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { loadConfig, type Config } from '../src/config.js';
import { buildApp } from '../src/app.js';
import type { AuthService, Role } from '../src/auth.js';
import { base32Decode, hotp, timeStep } from '../src/totp.js';

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://raelstream:dev@localhost:55432/raelstream';

export const ORIGIN = 'https://studio.test';
export const PASSWORD = 'correct horse battery staple';

/** Fresh database per test file. */
export async function freshDb(name: string): Promise<{ db: Kysely<DB>; url: string }> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]+$/, `/${name}`);
  const db = createDb(url);
  await migrate(db, new URL('../../../infra/migrations', import.meta.url).pathname);
  return { db, url };
}

export function testConfig(databaseUrl: string, extra: Record<string, string> = {}): Config {
  return loadConfig({
    DATABASE_URL: databaseUrl,
    PUBLIC_ORIGIN: ORIGIN,
    WHIP_PUBLIC_BASE: `${ORIGIN}/whip`,
    NODE_ENV: 'test',
    RS_PAIR_RATE_LIMIT: '1000',
    RS_LOGIN_RATE_LIMIT: '1000',
    ...extra,
  } as NodeJS.ProcessEnv);
}

/**
 * TOTP codes for tests. Each code is single use (replay protection), so we hand out the next unused
 * step inside the ±1 window. That allows up to three sign-ins per 30 s per user.
 */
const lastStep = new Map<string, number>();
export function nextCode(secretB32: string, key: string): string {
  const now = timeStep();
  const step = Math.max(now - 1, (lastStep.get(key) ?? 0) + 1);
  if (step > now + 1) throw new Error('test signed in too often within 30 s');
  lastStep.set(key, step);
  return hotp(base32Decode(secretB32), step);
}

export interface TestUser {
  email: string;
  secret: string;
  role: Role;
  recoveryCodes: string[];
}

export async function createTestUser(
  auth: AuthService,
  email: string,
  role: Role,
  name = email.split('@')[0]!,
): Promise<TestUser> {
  const r = await auth.createUser({ email, name, role, password: PASSWORD });
  return { email, secret: r.enrolment.secret, role, recoveryCodes: r.enrolment.recoveryCodes };
}

/** Sign in through the real HTTP flow; returns headers for state-changing requests. */
export async function signIn(app: FastifyInstance, u: TestUser, clientId = crypto.randomUUID()) {
  const a = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: ORIGIN },
    payload: { email: u.email, password: PASSWORD },
  });
  if (a.statusCode !== 200) throw new Error(`login failed ${a.statusCode} ${a.body}`);
  const b = await app.inject({
    method: 'POST',
    url: '/api/auth/mfa',
    headers: { origin: ORIGIN },
    payload: { challenge: a.json().challenge, code: nextCode(u.secret, u.email) },
  });
  if (b.statusCode !== 200) throw new Error(`mfa failed ${b.statusCode} ${b.body}`);
  const cookie = b.cookies[0]!;
  const cookieHeader = `${cookie.name}=${cookie.value}`;
  const headers = {
    cookie: cookieHeader,
    origin: ORIGIN,
    'x-rs-csrf': b.json().csrf as string,
    'x-rs-client': clientId,
  };
  return { headers, cookieHeader, clientId };
}

/** App + a signed-in owner whose requests carry a studio client id (lease holder after creating a session). */
export async function appWithOperator(
  db: Kysely<DB>,
  url: string,
  extra: Record<string, string> = {},
) {
  const { app, hub, auth } = await buildApp(testConfig(url, extra), db);
  const owner = await createTestUser(
    auth,
    `owner-${crypto.randomUUID().slice(0, 8)}@church.test`,
    'owner',
    'Chanda',
  );
  const { headers, cookieHeader, clientId } = await signIn(app, owner);
  return { app, hub, auth, owner, headers, cookieHeader, clientId };
}

export const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
export const DEVICE2 = 'BBBBBBBBBBBBBBBBBBBBBB';
