import pg from 'pg';
import type { Kysely } from 'kysely';
import { createDb, type DB } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { loadConfig, type Config } from '../src/config.js';
import { buildApp } from '../src/app.js';

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://raelstream:dev@localhost:55432/raelstream';

export const ORIGIN = 'https://studio.test';

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

export function testConfig(databaseUrl: string): Config {
  return loadConfig({
    DATABASE_URL: databaseUrl,
    PUBLIC_ORIGIN: ORIGIN,
    WHIP_PUBLIC_BASE: `${ORIGIN}/whip`,
    RS_DEV_AUTH: '1',
    RS_DEV_PASSPHRASE: 'test-passphrase-123',
    NODE_ENV: 'test',
    RS_PAIR_RATE_LIMIT: '1000',
  } as NodeJS.ProcessEnv);
}

export async function appWithOperator(db: Kysely<DB>, url: string) {
  const { app, hub } = await buildApp(testConfig(url), db);
  const login = await app.inject({
    method: 'POST',
    url: '/api/dev/login',
    payload: { name: 'Chanda', passphrase: 'test-passphrase-123' },
  });
  const cookie = login.cookies[0]!;
  const { csrf } = login.json() as { csrf: string };
  const headers = { cookie: `${cookie.name}=${cookie.value}`, origin: ORIGIN, 'x-rs-csrf': csrf };
  return { app, hub, headers, cookieHeader: `${cookie.name}=${cookie.value}` };
}

export const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
export const DEVICE2 = 'BBBBBBBBBBBBBBBBBBBBBB';
