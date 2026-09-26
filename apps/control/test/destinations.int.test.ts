import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { generateKeypair, open } from '@raelstream/secrets';
import type { DB } from '../src/db.js';
import type { AuthService } from '../src/auth.js';
import { appWithOperator, createTestUser, freshDb, signIn } from './helpers.js';

let db: Kysely<DB>;
let app: FastifyInstance;
let auth: AuthService;
let owner: Record<string, string>;
let operator: Record<string, string>;
let kp: { publicKey: string; secretKey: string };
let sink: Server;
let sinkPort: number;

beforeAll(async () => {
  const f = await freshDb('rs_test_destinations');
  db = f.db;
  kp = await generateKeypair();
  ({
    app,
    auth,
    headers: owner,
  } = await appWithOperator(db, f.url, {
    RS_SEAL_PUBLIC_KEY: kp.publicKey,
    RS_DEST_TEST_SINKS: '1',
  }));
  const op = await createTestUser(auth, 'op@church.test', 'operator', 'Mwila');
  ({ headers: operator } = await signIn(app, op));
  sink = createServer((s) => s.end());
  await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r));
  sinkPort = (sink.address() as { port: number }).port;
});
afterAll(async () => {
  sink.close();
  await app.close();
  await db.destroy();
});

const call = (method: string, url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({
    method: method as 'GET',
    url,
    headers,
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

const YT = {
  platform: 'youtube',
  label: 'YouTube church channel',
  serverUrl: 'rtmps://a.rtmps.youtube.com/live2',
  keyMode: 'persistent',
  autoPublishesOnIngest: 'no',
  watchUrl: 'https://www.youtube.com/@church/live',
  eventReference: 'Sunday stream',
};

describe('destination management (SPEC §13.1, A40, A41)', () => {
  it('lets the owner add one; the key is sealed and never returned', async () => {
    const r = await call('POST', '/api/destinations', owner, { ...YT, key: 'abcd-efgh-ijkl-mnop' });
    expect(r.statusCode).toBe(200);
    const id = r.json().id;
    const list = await call('GET', '/api/destinations', operator);
    expect(list.body).not.toContain('abcd-efgh-ijkl-mnop');
    expect(list.json()).toContainEqual(
      expect.objectContaining({ id, keyLast4: 'mnop', eventReference: 'Sunday stream' }),
    );
    const row = await db
      .selectFrom('destinations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(await open(kp, row.key_enc!)).toBe('abcd-efgh-ijkl-mnop');
    // Replace, never reveal.
    const k = await call('PUT', `/api/destinations/${id}/key`, owner, { key: 'wxyz-new-key-9876' });
    expect(k.json()).toEqual({ keyLast4: '9876' });
    expect(k.body).not.toContain('wxyz');
  });

  it('refuses servers that are not official ingest addresses (A41), and non-owners', async () => {
    for (const serverUrl of [
      'rtmps://127.0.0.1/live2',
      'rtmps://169.254.169.254/latest',
      'rtmps://a.rtmps.youtube.com.evil.example/live2',
      'rtmp://a.rtmps.youtube.com/live2',
      'rtmps://user:pass@a.rtmps.youtube.com/live2',
    ]) {
      const r = await call('POST', '/api/destinations', owner, { ...YT, serverUrl });
      expect(r.statusCode, serverUrl).toBe(400);
      expect(r.json().code).toBe('DEST_URL_NOT_ALLOWED');
    }
    expect((await call('POST', '/api/destinations', operator, YT)).statusCode).toBe(403);
    const bad = await call('POST', '/api/destinations', owner, {
      ...YT,
      watchUrl: 'https://evil.example/',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('validates by connecting to the ingest host without sending media', async () => {
    const ok = await call('POST', '/api/destinations', owner, {
      ...YT,
      platform: 'facebook',
      serverUrl: `rtmp://127.0.0.1:${sinkPort}/watch/facebook`,
    });
    expect(
      (await call('POST', `/api/destinations/${ok.json().id}/validate`, owner)).json(),
    ).toEqual({
      ok: true,
    });
    const closed = await call('POST', '/api/destinations', owner, {
      ...YT,
      serverUrl: 'rtmp://127.0.0.1:1/watch/youtube',
    });
    const v = await call('POST', `/api/destinations/${closed.json().id}/validate`, owner);
    expect(v.json().code).toBe('DEST_UNREACHABLE');
  });
});

describe('Facebook per-event key (SPEC §13.3, I-13)', () => {
  it('is pasted per service, blocks Start until present, warns on reuse, and is wiped at the end', async () => {
    const fb = (
      await call('POST', '/api/destinations', owner, {
        ...YT,
        platform: 'facebook',
        label: 'Facebook Page',
        serverUrl: 'rtmps://live-api-s.facebook.com:443/rtmp/',
        keyMode: 'per_event',
        autoPublishesOnIngest: 'unknown',
        watchUrl: '',
      })
    ).json().id;
    const s1 = (await call('POST', '/api/sessions', owner, { name: 'Sunday 1' })).json().id;
    const start = () =>
      call('POST', `/api/sessions/${s1}/start`, owner, {
        mode: 'live',
        profile: 'reliable_hd',
        destinationIds: [fb],
      });
    expect((await start()).json().code).toBe('DEST_KEY_MISSING');
    // The operator without the lease cannot paste it into someone else's running studio.
    expect(
      (
        await call('PUT', `/api/sessions/${s1}/destinations/${fb}/key`, operator, {
          key: 'FB-1111-2222-aaaa',
        })
      ).statusCode,
    ).toBe(409);
    const paste = await call('PUT', `/api/sessions/${s1}/destinations/${fb}/key`, owner, {
      key: 'FB-1111-2222-aaaa',
    });
    expect(paste.json()).toEqual({ keyLast4: 'aaaa', sameAsLast: false });
    const state = await call('GET', `/api/sessions/${s1}/destinations`, owner);
    expect(state.json()).toContainEqual(
      expect.objectContaining({
        destinationId: fb,
        sessionKeyLast4: 'aaaa',
        sessionKeyPresent: true,
      }),
    );
    expect(state.body).not.toContain('FB-1111');
    expect((await start()).statusCode).toBe(200);

    // "I've checked the platform playback"
    const c = await call('POST', `/api/sessions/${s1}/destinations/${fb}/confirm`, owner);
    expect(c.json().by).toBe('Chanda');

    // End the service: the key is wiped by the database, whichever process ends it.
    await db
      .updateTable('stream_sessions')
      .set({ lifecycle: 'ENDED', ended_at: new Date() })
      .where('id', '=', s1)
      .execute();
    const row = await db
      .selectFrom('session_destinations')
      .selectAll()
      .where('session_id', '=', s1)
      .executeTakeFirstOrThrow();
    expect(row.session_key_enc).toBeNull();
    expect(row.session_key_last4).toBe('aaaa');

    // Next week: pasting the same key again warns that Facebook may have issued a new one.
    const s2 = (await call('POST', '/api/sessions', owner, { name: 'Sunday 2' })).json().id;
    const again = await call('PUT', `/api/sessions/${s2}/destinations/${fb}/key`, owner, {
      key: 'FB-9999-2222-aaaa',
    });
    expect(again.json().sameAsLast).toBe(true);
  });
});

describe('uplink test (SPEC §11.3)', () => {
  it('counts streamed bytes without storing them, and stores the result outside broadcasts', async () => {
    const body = Buffer.alloc(3 * 1024 * 1024, 7);
    const r = await app.inject({
      method: 'POST',
      url: '/api/uplink-test/sink',
      headers: { ...owner, 'content-type': 'application/x-rs-uplink' },
      payload: body,
    });
    expect(r.json()).toEqual({ bytes: body.length });
    const s = (await call('GET', '/api/sessions/active', owner)).json().id;
    const result = {
      httpMbps: 9.4,
      bytes: 40_000_000,
      seconds: 18,
      offer: 'reliable_hd',
      measuredAt: new Date().toISOString(),
    };
    expect((await call('POST', `/api/sessions/${s}/uplink-test`, owner, result)).statusCode).toBe(
      200,
    );
    expect((await call('GET', `/api/sessions/${s}/config`, owner)).json().uplinkTest).toMatchObject(
      {
        offer: 'reliable_hd',
      },
    );
    await db
      .updateTable('stream_sessions')
      .set({ lifecycle: 'SENDING' })
      .where('id', '=', s)
      .execute();
    expect((await call('POST', `/api/sessions/${s}/uplink-test`, owner, result)).statusCode).toBe(
      403,
    );
  });
});
