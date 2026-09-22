import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { generateKeypair, seal } from '@raelstream/secrets';
import type { DB } from '../src/db.js';
import { appWithOperator, freshDb } from './helpers.js';
import { authorizeMediaMtx } from '../src/ingest.js';

let db: Kysely<DB>;
let url: string;
let app: FastifyInstance;
let headers: Record<string, string>;
let sessionId: string;
let withKey: string;
let noKey: string;

beforeAll(async () => {
  const f = await freshDb('rs_test_media_api');
  db = f.db;
  url = f.url;
  ({ app, headers } = await appWithOperator(db, f.url));
  sessionId = (
    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers,
      payload: { name: 'Media API' },
    })
  ).json().id;
  const kp = await generateKeypair();
  withKey = (
    await db
      .insertInto('destinations')
      .values({
        platform: 'youtube',
        label: 'YouTube',
        server_url: 'rtmps://a.rtmps.youtube.com/live2',
        key_enc: await seal(kp.publicKey, 'yt-secret-key-1'),
        key_last4: 'ey-1',
        key_mode: 'persistent',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  noKey = (
    await db
      .insertInto('destinations')
      .values({
        platform: 'facebook',
        label: 'Facebook Page',
        server_url: 'rtmps://live-api-s.facebook.com:443/rtmp/',
        key_mode: 'per_event',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const start = (payload: Record<string, unknown>, extra: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/start`,
    headers: { ...headers, ...extra },
    payload,
  });
const desired = async () =>
  await db
    .selectFrom('stream_sessions')
    .select(['desired_state', 'lifecycle'])
    .where('id', '=', sessionId)
    .executeTakeFirstOrThrow();

describe('destinations API (B§16.2)', () => {
  it('never returns keys or ciphertext', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/destinations', headers });
    expect(r.statusCode).toBe(200);
    const body = r.body;
    expect(body).not.toContain('yt-secret-key-1');
    expect(body).not.toContain('key_enc');
    expect(r.json().find((d: { id: string }) => d.id === withKey).keyLast4).toBe('ey-1');
  });
});

describe('start / stop / retry (SPEC §12.1)', () => {
  it('blocks live start with no destinations or a missing key (B§16.4)', async () => {
    expect(
      (await start({ mode: 'live', profile: 'reliable_hd', destinationIds: [] })).json().code,
    ).toBe('DEST_NOT_CONFIGURED');
    expect(
      (await start({ mode: 'live', profile: 'reliable_hd', destinationIds: [noKey] })).json().code,
    ).toBe('DEST_KEY_MISSING');
    expect((await desired()).desired_state).toEqual({});
  });

  it('writes desired state and notifies the supervisor', async () => {
    const listener = new pg.Client({ connectionString: url });
    await listener.connect();
    await listener.query('listen desired_changed');
    const got = new Promise<string>((res) =>
      listener.on('notification', (n) => res(n.payload ?? '')),
    );
    const r = await start({ mode: 'ingest_test', profile: 'reliable_hd', destinationIds: [] });
    expect(r.statusCode).toBe(200);
    expect(await got).toBe(sessionId);
    await listener.end();
    const d = await desired();
    expect(d.desired_state).toMatchObject({
      mode: 'ingest_test',
      normaliser: 'running',
      publishers: {},
      endOnStop: false,
    });
    expect(d.lifecycle).toBe('PREPARING'); // private test never enters a live state
  });

  it('refuses to change the profile of a running programme (B§14.3)', async () => {
    expect(
      (await start({ mode: 'live', profile: 'full_hd', destinationIds: [withKey] })).statusCode,
    ).toBe(400);
  });

  it('upgrades to live; the same idempotency key returns the same result (A32)', async () => {
    const key = crypto.randomUUID();
    const a = await start(
      { mode: 'live', profile: 'reliable_hd', destinationIds: [withKey] },
      { 'idempotency-key': key },
    );
    const b = await start(
      { mode: 'live', profile: 'reliable_hd', destinationIds: [withKey] },
      { 'idempotency-key': key },
    );
    expect(a.json()).toEqual(b.json());
    const d = await desired();
    expect(d.lifecycle).toBe('STARTING');
    expect(d.desired_state).toMatchObject({
      mode: 'live',
      endOnStop: true,
      publishers: { [withKey]: { state: 'running', retryNonce: 0 } },
    });
  });

  it('retries only the named destination', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/destinations/${withKey}/retry`,
      headers,
    });
    expect(r.statusCode).toBe(200);
    expect((await desired()).desired_state).toMatchObject({
      publishers: { [withKey]: { retryNonce: 1 } },
    });
    const other = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/destinations/${noKey}/retry`,
      headers,
    });
    expect(other.json().code).toBe('NOT_SENDING');
  });

  it('stop is idempotent and moves a live session to STOPPING (A34)', async () => {
    const a = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/stop`, headers });
    const b = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/stop`, headers });
    expect(a.json()).toEqual({ stopping: true });
    expect(b.json()).toEqual({ stopping: true });
    const d = await desired();
    expect(d.lifecycle).toBe('STOPPING');
    expect((d.desired_state as { stopRequestedAt: string | null }).stopRequestedAt).not.toBeNull();
    expect(
      (await start({ mode: 'live', profile: 'reliable_hd', destinationIds: [withKey] })).statusCode,
    ).toBe(409);
  });
});

describe('normalised path access (ADR-0003)', () => {
  it('only the supervisor may publish or read norm/ paths', async () => {
    const internal = { user: 'supervisor', pass: 'dev-internal' };
    const path = `norm/${sessionId}/abc`;
    expect(
      await authorizeMediaMtx(
        db,
        { action: 'publish', path, user: 'supervisor', password: 'dev-internal', ip: '172.18.0.5' },
        internal,
      ),
    ).toBe(true);
    expect(
      await authorizeMediaMtx(
        db,
        {
          action: 'publish',
          path,
          user: 'supervisor',
          password: 'dev-internal',
          ip: '203.0.113.7',
        },
        internal,
      ),
    ).toBe(false);
    expect(
      await authorizeMediaMtx(db, { action: 'publish', path, token: 'x'.repeat(43) }, internal),
    ).toBe(false);
    expect(
      await authorizeMediaMtx(
        db,
        { action: 'read', path, user: 'any', password: '', ip: '127.0.0.1' },
        internal,
      ),
    ).toBe(false);
  });
});
