import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { DB } from '../src/db.js';
import { freshDb } from './helpers.js';

const run = promisify(execFile);
let db: Kysely<DB>;
let url: string;

beforeAll(async () => {
  ({ db, url } = await freshDb('rs_test_deploy_guard'));
});
afterAll(async () => {
  await db.destroy();
});

async function guard(): Promise<{ code: number; out: string }> {
  try {
    const r = await run('pnpm', ['exec', 'tsx', 'src/cli.ts', 'deploy:guard'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: {
        ...process.env,
        DATABASE_URL: url,
        PUBLIC_ORIGIN: 'https://guard.test',
        WHIP_PUBLIC_BASE: 'https://guard.test/whip',
        NODE_ENV: 'test',
        MIGRATIONS_DIR: new URL('../../../infra/migrations', import.meta.url).pathname,
      },
    });
    return { code: 0, out: r.stdout };
  } catch (e) {
    const x = e as { code: number; stderr: string };
    return { code: x.code, out: x.stderr };
  }
}

const session = (name: string, lifecycle: string) =>
  db
    .insertInto('stream_sessions')
    .values({ name, lifecycle, operator_name: 'Chanda' } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
const setState = (id: string, lifecycle: string) =>
  db
    .updateTable('stream_sessions')
    .set({ lifecycle } as never)
    .where('id', '=', id)
    .execute();

describe('deploy guard (SPEC §16.2, A43)', () => {
  it('allows a finished or forgotten service; refuses a live one or an open studio', async () => {
    await session('Last week', 'ENDED');
    const s = await session('Sunday Service', 'PREPARING');
    expect(await guard()).toMatchObject({ code: 0 }); // nobody has the studio open

    await setState(s.id, 'SENDING');
    const live = await guard();
    expect(live.code).toBe(3);
    expect(live.out).toContain('Active service; deploy after it ends: Sunday Service (SENDING)');

    await setState(s.id, 'READY');
    const owner = await db
      .insertInto('users')
      .values({
        email: 'o@guard.test',
        display_name: 'O',
        role: 'owner',
        password_hash: 'x',
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('studio_leases')
      .values({
        session_id: s.id,
        holder_user_id: owner.id,
        holder_client_id: crypto.randomUUID(),
        generation: 1,
        expires_at: new Date(Date.now() + 30_000),
      })
      .execute();
    expect((await guard()).code).toBe(3); // someone is preparing right now

    await db
      .updateTable('studio_leases')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .execute();
    expect((await guard()).code).toBe(0);
  }, 90_000);
});
