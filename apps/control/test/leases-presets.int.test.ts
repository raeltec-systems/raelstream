import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../src/db.js';
import type { AuthService } from '../src/auth.js';
import { runRetention } from '../src/retention.js';
import { DEVICE, ORIGIN, appWithOperator, createTestUser, freshDb, signIn } from './helpers.js';

let db: Kysely<DB>;
let app: FastifyInstance;
let auth: AuthService;
let ownerA: Record<string, string>; // owner, tab A (lease holder)
let ownerCookie: string;
let sessionId: string;
let presetId: string;

beforeAll(async () => {
  const f = await freshDb('rs_test_leases');
  db = f.db;
  ({ app, auth, headers: ownerA, cookieHeader: ownerCookie } = await appWithOperator(db, f.url));
  await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const post = (url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers,
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

describe('presets (WP1)', () => {
  it('creates, lists and updates a preset', async () => {
    const r = await post('/api/presets', ownerA, {
      name: 'Sunday Service',
      fallbackGraceS: 180,
      rundown: [
        {
          id: crypto.randomUUID(),
          type: 'lower_third',
          title: 'Pastor',
          line1: 'Pastor Mwansa Banda',
          line2: 'Sunday sermon',
        },
      ],
      audioDefaults: { mode: 'in1_both', gainDb: 3, delayMs: 120 },
    });
    expect(r.statusCode).toBe(200);
    presetId = r.json().id;
    const list = (await app.inject({ method: 'GET', url: '/api/presets', headers: ownerA })).json();
    expect(list[0]).toMatchObject({ name: 'Sunday Service', fallbackGraceS: 180 });
    const u = await app.inject({
      method: 'PATCH',
      url: `/api/presets/${presetId}`,
      headers: ownerA,
      payload: { name: 'Sunday Service 10:00' },
    });
    expect(u.json().name).toBe('Sunday Service 10:00');
  });

  it('rejects oversized rundowns', async () => {
    const items = Array.from({ length: 41 }, () => ({
      id: crypto.randomUUID(),
      type: 'text',
      title: 't',
      detail: '',
    }));
    expect(
      (await post('/api/presets', ownerA, { name: 'Too long', rundown: items })).statusCode,
    ).toBe(400);
  });

  it('a session started from a preset copies its rundown, audio and grace; the creating tab holds the lease', async () => {
    const r = await post('/api/sessions', ownerA, { name: 'Sunday 22 Sep', presetId });
    expect(r.statusCode).toBe(200);
    sessionId = r.json().id;
    const cfg = (
      await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/config`, headers: ownerA })
    ).json();
    expect(cfg).toMatchObject({
      presetId,
      presetName: 'Sunday Service 10:00',
      fallbackGraceS: 180,
      audio: { gainDb: 3, delayMs: 120 },
    });
    expect(cfg.rundown).toHaveLength(1);
    const lease = await db
      .selectFrom('studio_leases')
      .selectAll()
      .where('session_id', '=', sessionId)
      .executeTakeFirstOrThrow();
    expect(lease.holder_client_id).toBe(ownerA['x-rs-client']);
  });

  it('saves the session rundown, and to the preset only when asked', async () => {
    const items = [
      { id: crypto.randomUUID(), type: 'text', title: 'Welcome', detail: 'Grace Chapel' },
    ];
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/sessions/${sessionId}/rundown`,
          headers: ownerA,
          payload: { items },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await db
          .selectFrom('presets')
          .select('rundown')
          .where('id', '=', presetId)
          .executeTakeFirstOrThrow()
      ).rundown,
    ).toHaveLength(1);
    expect(
      (
        await db
          .selectFrom('presets')
          .select('rundown')
          .where('id', '=', presetId)
          .executeTakeFirstOrThrow()
      ).rundown[0],
    ).toMatchObject({ type: 'lower_third' });
    await app.inject({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/rundown`,
      headers: ownerA,
      payload: { items, saveToPreset: true },
    });
    expect(
      (
        await db
          .selectFrom('presets')
          .select('rundown')
          .where('id', '=', presetId)
          .executeTakeFirstOrThrow()
      ).rundown[0],
    ).toMatchObject({ title: 'Welcome' });
  });
});

describe('studio lease and takeover (A33, SPEC §17.3)', () => {
  let ownerB: Record<string, string>;
  let operator: { headers: Record<string, string> };

  beforeAll(async () => {
    // the same owner in a second tab: new client id, same account
    ownerB = { ...ownerA, 'x-rs-client': crypto.randomUUID() };
    const op = await createTestUser(auth, 'op@church.test', 'operator', 'Chanda');
    operator = await signIn(app, op);
  });

  it('a second tab opens read-only and cannot issue commands', async () => {
    const l = (await post(`/api/sessions/${sessionId}/lease`, ownerB)).json();
    expect(l).toMatchObject({
      mine: false,
      holderIsMe: true,
      holderName: 'Chanda',
      canTakeOver: true,
    });
    const r = await post(`/api/sessions/${sessionId}/pairings`, ownerB);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('LEASE_HELD');
    expect((await post(`/api/sessions/${sessionId}/pairings`, ownerA)).statusCode).toBe(200);
  });

  it('renewal by the holder keeps the lease', async () => {
    const l = (await post(`/api/sessions/${sessionId}/lease`, ownerA)).json();
    expect(l.mine).toBe(true);
  });

  it('an operator cannot take over from someone else while the lease is live', async () => {
    const l = (await post(`/api/sessions/${sessionId}/lease`, operator.headers)).json();
    expect(l).toMatchObject({ mine: false, holderIsMe: false, canTakeOver: false });
    expect((await post(`/api/sessions/${sessionId}/takeover`, operator.headers)).statusCode).toBe(
      403,
    );
  });

  it('owners can stop without the lease; operators cannot', async () => {
    expect((await post(`/api/sessions/${sessionId}/stop`, operator.headers)).json().code).toBe(
      'LEASE_HELD',
    );
    expect((await post(`/api/sessions/${sessionId}/stop`, ownerB)).statusCode).toBe(200);
  });

  it('takeover bumps the generation, fences the old tab and its WHIP token, and tells the phone', async () => {
    // an ingest token for generation 1 and a desired state for the supervisor
    await post(`/api/sessions/${sessionId}/mode`, ownerA, { mode: 'ingest_test' });
    const ingest = (await post(`/api/sessions/${sessionId}/ingest`, ownerA)).json();
    expect(ingest.whipUrl).toContain('/g1/contrib');
    await post(`/api/sessions/${sessionId}/start`, ownerA, {
      mode: 'ingest_test',
      profile: 'reliable_hd',
      destinationIds: [],
    });

    // tab A listens; a phone is connected
    const port = (app.server.address() as { port: number }).port;
    const open = (cookie?: string) =>
      new Promise<WebSocket>((res, rej) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
          headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
        });
        ws.on('open', () => res(ws));
        ws.on('error', rej);
      });
    const collect = (ws: WebSocket) => {
      const got: string[] = [];
      ws.on('message', (d) => got.push(JSON.parse(d.toString()).type));
      return got;
    };
    const tabA = await open(ownerCookie);
    const aMsgs = collect(tabA);
    tabA.send(
      JSON.stringify({ type: 'hello', role: 'studio', sessionId, clientId: ownerA['x-rs-client'] }),
    );
    const inv = (await post(`/api/sessions/${sessionId}/pairings`, ownerA)).json();
    const claim = (
      await app.inject({
        method: 'POST',
        url: '/api/pairings/claim',
        payload: { token: inv.url.split('#t=')[1], deviceId: DEVICE, label: 'Camera 1' },
      })
    ).json();
    // like a real phone: connected while pending, then admitted (which rotates its credential)
    const cam = await open();
    const camMsgs = collect(cam);
    cam.send(JSON.stringify({ type: 'hello', role: 'camera', credential: claim.credential }));
    await new Promise((r) => setTimeout(r, 200));
    await post(`/api/sessions/${sessionId}/sources/${claim.sourceId}/admit`, ownerA);
    await new Promise((r) => setTimeout(r, 200));
    expect(camMsgs).toContain('admitted');

    const t = await post(`/api/sessions/${sessionId}/takeover`, ownerB);
    expect(t.json()).toEqual({ generation: 2 });
    await new Promise((r) => setTimeout(r, 300));
    expect(aMsgs).toContain('lease.lost');
    expect(camMsgs).toContain('studio.changed');

    const s = await db
      .selectFrom('stream_sessions')
      .select(['generation', 'desired_state'])
      .where('id', '=', sessionId)
      .executeTakeFirstOrThrow();
    expect(s.generation).toBe(2);
    expect(s.desired_state).toMatchObject({ generation: 2 });
    const tok = await db
      .selectFrom('ingest_tokens')
      .select(['generation', 'revoked_at'])
      .where('session_id', '=', sessionId)
      .execute();
    expect(tok.filter((x) => x.generation === 1).every((x) => x.revoked_at)).toBe(true);

    // the old tab is fenced; the new tab works and gets a generation-2 path
    expect((await post(`/api/sessions/${sessionId}/pairings`, ownerA)).json().code).toBe(
      'LEASE_HELD',
    );
    expect((await post(`/api/sessions/${sessionId}/ingest`, ownerB)).json().whipUrl).toContain(
      '/g2/contrib',
    );
    tabA.close();
    cam.close();
  });

  it('an operator may take over an expired lease', async () => {
    await db
      .updateTable('studio_leases')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('session_id', '=', sessionId)
      .execute();
    expect((await post(`/api/sessions/${sessionId}/takeover`, operator.headers)).json()).toEqual({
      generation: 3,
    });
  });
});

describe('retention (SPEC §5)', () => {
  it('removes expired security records and keeps current ones', async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    const users = await db.selectFrom('users').select('id').execute();
    await db
      .insertInto('auth_sessions')
      .values({
        id_hash: Buffer.alloc(32, 7),
        user_id: users[0]!.id,
        csrf: 'x',
        last_seen_at: old,
        expires_at: old,
      })
      .execute();
    await db
      .insertInto('mfa_challenges')
      .values({
        id_hash: Buffer.alloc(32, 8),
        user_id: users[0]!.id,
        purpose: 'login',
        expires_at: old,
      })
      .execute();
    const r = await runRetention(db);
    expect(r.auth_sessions).toBe(1);
    expect(r.mfa_challenges).toBeGreaterThanOrEqual(1);
    expect(
      (await db.selectFrom('auth_sessions').select('id_hash').execute()).length,
    ).toBeGreaterThan(0); // live sessions kept
  });
});
