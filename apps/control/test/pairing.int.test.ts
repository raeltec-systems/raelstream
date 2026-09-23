import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../src/db.js';
import { DEVICE, DEVICE2, ORIGIN, appWithOperator, freshDb } from './helpers.js';
import { authorizeMediaMtx } from '../src/ingest.js';

let db: Kysely<DB>;
let app: FastifyInstance;
let headers: Record<string, string>;
let sessionId: string;

beforeAll(async () => {
  const f = await freshDb('rs_test_pairing');
  db = f.db;
  ({ app, headers } = await appWithOperator(db, f.url));
  const res = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers,
    payload: { name: 'Sunday Service' },
  });
  expect(res.statusCode).toBe(200);
  sessionId = res.json().id;
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

async function invite(): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/pairings`,
    headers,
  });
  expect(r.statusCode).toBe(200);
  const url: string = r.json().url;
  expect(url.startsWith(`${ORIGIN}/cam#t=`)).toBe(true);
  return url.split('#t=')[1]!;
}

describe('dev sign-in is gone (M4)', () => {
  it('has no /api/dev/login route', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/dev/login',
      payload: { name: 'Mallory', passphrase: 'x' },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('sessions', () => {
  it('allows only one active session (max_concurrent_sessions: 1)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers,
      payload: { name: 'Second' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('SESSION_ACTIVE_EXISTS');
  });
  it('rejects state changes without the CSRF header or from another origin', async () => {
    const noCsrf = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/pairings`,
      headers: { cookie: headers.cookie!, origin: ORIGIN },
    });
    expect(noCsrf.statusCode).toBe(403);
    const evil = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/pairings`,
      headers: { ...headers, origin: 'https://evil.test' },
    });
    expect(evil.statusCode).toBe(403);
    const anon = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/pairings`,
      headers: { origin: ORIGIN },
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe('pairing (PAIR-01..05)', () => {
  it('preview does not consume the invitation (A05)', async () => {
    const token = await invite();
    for (let i = 0; i < 3; i++) {
      const p = await app.inject({
        method: 'POST',
        url: '/api/pairings/preview',
        payload: { token },
      });
      expect(p.statusCode).toBe(200);
      expect(p.json()).toEqual({ serviceName: 'Sunday Service', operatorName: 'Chanda' });
    }
    const c = await app.inject({
      method: 'POST',
      url: '/api/pairings/claim',
      payload: { token, deviceId: DEVICE, label: 'Camera 1' },
    });
    expect(c.statusCode).toBe(200);
    expect(c.json().verificationPhrase).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
    // consumed: preview and claim now fail with the generic message
    const again = await app.inject({
      method: 'POST',
      url: '/api/pairings/preview',
      payload: { token },
    });
    expect(again.statusCode).toBe(410);
    expect(again.json().message).toMatch(/no longer valid/);
    // clean up the pending source for later tests
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/sources/${c.json().sourceId}/reject`,
      headers,
    });
  });

  it('two concurrent claims of one invitation create exactly one pending source (A04)', async () => {
    const token = await invite();
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/pairings/claim',
        payload: { token, deviceId: DEVICE, label: 'A' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/pairings/claim',
        payload: { token, deviceId: DEVICE2, label: 'B' },
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 410]);
    const pending = await db
      .selectFrom('camera_sources')
      .selectAll()
      .where('session_id', '=', sessionId)
      .where('status', '=', 'pending')
      .execute();
    expect(pending).toHaveLength(1);
    await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${sessionId}/sources/${pending[0]!.id}`,
      headers,
    });
  });

  it('rejects expired invitations (A03)', async () => {
    const token = await invite();
    await db
      .updateTable('camera_invitations')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('consumed_at', 'is', null)
      .execute();
    const c = await app.inject({
      method: 'POST',
      url: '/api/pairings/claim',
      payload: { token, deviceId: DEVICE, label: 'Late' },
    });
    expect(c.statusCode).toBe(410);
  });

  it('a new code invalidates the previous unconsumed code', async () => {
    const first = await invite();
    await invite();
    const p = await app.inject({
      method: 'POST',
      url: '/api/pairings/preview',
      payload: { token: first },
    });
    expect(p.statusCode).toBe(410);
  });

  it('refuses a second camera while slot 1 is taken (E04)', async () => {
    const t1 = await invite();
    const c1 = await app.inject({
      method: 'POST',
      url: '/api/pairings/claim',
      payload: { token: t1, deviceId: DEVICE, label: 'One' },
    });
    expect(c1.statusCode).toBe(200);
    const t2 = await invite();
    const c2 = await app.inject({
      method: 'POST',
      url: '/api/pairings/claim',
      payload: { token: t2, deviceId: DEVICE2, label: 'Two' },
    });
    expect(c2.statusCode).toBe(409);
    expect(c2.json().code).toBe('PAIR_SLOT_TAKEN');
    await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${sessionId}/sources/${c1.json().sourceId}`,
      headers,
    });
  });

  it('admission rotates the credential; revocation invalidates it (A12)', async () => {
    const token = await invite();
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/pairings/claim',
        payload: { token, deviceId: DEVICE, label: 'Pulpit' },
      })
    ).json();
    const pendingHash = (
      await db
        .selectFrom('camera_sources')
        .select('credential_hash')
        .where('id', '=', c.sourceId)
        .executeTakeFirstOrThrow()
    ).credential_hash;
    const adm = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/sources/${c.sourceId}/admit`,
      headers,
    });
    expect(adm.statusCode).toBe(200);
    const row = await db
      .selectFrom('camera_sources')
      .selectAll()
      .where('id', '=', c.sourceId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('admitted');
    expect(row.credential_hash.equals(pendingHash)).toBe(false);
    const rev = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${sessionId}/sources/${c.sourceId}`,
      headers,
    });
    expect(rev.statusCode).toBe(200);
    const again = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/sources/${c.sourceId}/admit`,
      headers,
    });
    expect(again.statusCode).toBe(404);
  });

  it('stores only hashes of invitation tokens', async () => {
    const token = await invite();
    const rows = await db.selectFrom('camera_invitations').select('token_hash').execute();
    for (const r of rows) expect(r.token_hash.toString('base64url')).not.toBe(token);
  });
});

describe('contribution and MediaMTX auth (A42)', () => {
  it('refuses ingest in rehearsal mode and scopes the WHIP token to one path', async () => {
    const reh = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/ingest`,
      headers,
    });
    expect(reh.statusCode).toBe(403);
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/mode`,
      headers,
      payload: { mode: 'ingest_test' },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/ingest`,
      headers,
    });
    expect(r.statusCode).toBe(200);
    const { whipUrl, bearer } = r.json();
    const path = `live/${sessionId}/g1/contrib`;
    expect(whipUrl).toBe(`${ORIGIN}/whip/${path}/whip`);
    const internal = { user: 'supervisor', pass: 'dev-internal' };
    expect(await authorizeMediaMtx(db, { action: 'publish', path, token: bearer }, internal)).toBe(
      true,
    );
    expect(
      await authorizeMediaMtx(
        db,
        { action: 'publish', path: 'live/other/g1/contrib', token: bearer },
        internal,
      ),
    ).toBe(false);
    expect(
      await authorizeMediaMtx(db, { action: 'publish', path, token: 'x'.repeat(43) }, internal),
    ).toBe(false);
    expect(
      await authorizeMediaMtx(
        db,
        { action: 'read', path, user: 'supervisor', password: 'dev-internal', ip: '203.0.113.9' },
        internal,
      ),
    ).toBe(false);
    expect(
      await authorizeMediaMtx(
        db,
        { action: 'read', path, user: 'supervisor', password: 'dev-internal', ip: '127.0.0.1' },
        internal,
      ),
    ).toBe(true);
    expect(
      await authorizeMediaMtx(
        db,
        { action: 'read', path, user: 'supervisor', password: 'wrong', ip: '127.0.0.1' },
        internal,
      ),
    ).toBe(false);
    // a newer generation fences the old token
    await db
      .updateTable('stream_sessions')
      .set({ generation: 2 })
      .where('id', '=', sessionId)
      .execute();
    expect(await authorizeMediaMtx(db, { action: 'publish', path, token: bearer }, internal)).toBe(
      false,
    );
    await db
      .updateTable('stream_sessions')
      .set({ generation: 1 })
      .where('id', '=', sessionId)
      .execute();
  });

  it('the auth hook endpoint answers 401 for anonymous publish', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/internal/mediamtx/auth',
      payload: { action: 'publish', path: 'live/x/g1/contrib' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('ending the session revokes ingest tokens and closes invitations', async () => {
    await invite();
    const r = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/end`, headers });
    expect(r.statusCode).toBe(200);
    const open = await db
      .selectFrom('camera_invitations')
      .select('id')
      .where('consumed_at', 'is', null)
      .execute();
    expect(open).toHaveLength(0);
    const tokens = await db.selectFrom('ingest_tokens').select('revoked_at').execute();
    expect(tokens.every((t) => t.revoked_at !== null)).toBe(true);
  });
});

describe('rate limiting (SPEC §14.4)', () => {
  it('limits pairing requests per IP', async () => {
    const f = await freshDb('rs_test_ratelimit');
    const { buildApp } = await import('../src/app.js');
    const { testConfig } = await import('./helpers.js');
    const { app: limited } = await buildApp({ ...testConfig(f.url), pairRateLimit: 3 }, f.db);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push(
        (
          await limited.inject({
            method: 'POST',
            url: '/api/pairings/preview',
            payload: { token: 'x'.repeat(43) },
          })
        ).statusCode,
      );
    }
    expect(codes).toEqual([410, 410, 410, 429, 429]);
    await limited.close();
    await f.db.destroy();
  });
});
