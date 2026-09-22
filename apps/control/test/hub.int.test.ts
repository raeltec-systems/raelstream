import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../src/db.js';
import { DEVICE, ORIGIN, appWithOperator, freshDb } from './helpers.js';

let db: Kysely<DB>;
let app: FastifyInstance;
let headers: Record<string, string>;
let cookieHeader: string;
let base: string;

beforeAll(async () => {
  const f = await freshDb('rs_test_hub');
  db = f.db;
  ({ app, headers, cookieHeader } = await appWithOperator(db, f.url));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  base = `ws://127.0.0.1:${addr.port}/ws`;
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

function open(
  cookie?: string,
  origin = ORIGIN,
): Promise<{ ws: WebSocket; next: (type?: string) => Promise<Record<string, unknown>> }> {
  const ws = new WebSocket(base, { headers: { origin, ...(cookie ? { cookie } : {}) } });
  const queue: Record<string, unknown>[] = [];
  const waiters: Array<(m: Record<string, unknown>) => void> = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  const next = async (type?: string): Promise<Record<string, unknown>> => {
    for (;;) {
      const m =
        queue.shift() ??
        (await new Promise<Record<string, unknown>>((res, rej) => {
          waiters.push(res);
          setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), 3000);
        }));
      if (!type || m.type === type) return m;
    }
  };
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve({ ws, next }));
    ws.on('error', reject);
  });
}

describe('WS hub', () => {
  it('relays signalling only between an admitted camera and its studio', async () => {
    const s = (
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers,
        payload: { name: 'Hub test' },
      })
    ).json();
    const inv = (
      await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/pairings`, headers })
    ).json();
    const token = inv.url.split('#t=')[1];
    const claim = (
      await app.inject({
        method: 'POST',
        url: '/api/pairings/claim',
        payload: { token, deviceId: DEVICE, label: 'Camera 1' },
      })
    ).json();

    const studio = await open(cookieHeader);
    studio.ws.send(
      JSON.stringify({
        type: 'hello',
        role: 'studio',
        sessionId: s.id,
        clientId: crypto.randomUUID(),
      }),
    );
    const welcome = await studio.next('welcome');
    expect((welcome.snapshot as { sources: unknown[] }).sources).toHaveLength(1);
    expect(await studio.next('peer')).toMatchObject({ sourceId: claim.sourceId, present: false });

    const cam = await open(undefined);
    cam.ws.send(JSON.stringify({ type: 'hello', role: 'camera', credential: claim.credential }));
    const cw = await cam.next('welcome');
    expect(cw.sourceStatus).toBe('pending');
    expect(await studio.next('peer')).toMatchObject({ sourceId: claim.sourceId, present: true });

    // pending cameras cannot signal
    cam.ws.send(
      JSON.stringify({
        type: 'signal',
        sourceId: claim.sourceId,
        payload: { type: 'offer', sdp: 'v=0' },
      }),
    );

    await app.inject({
      method: 'POST',
      url: `/api/sessions/${s.id}/sources/${claim.sourceId}/admit`,
      headers,
    });
    const adm = await cam.next('admitted');
    expect(typeof adm.credential).toBe('string');

    cam.ws.send(
      JSON.stringify({
        type: 'signal',
        sourceId: claim.sourceId,
        payload: { type: 'offer', sdp: 'v=0 real' },
      }),
    );
    const sig = await studio.next('signal');
    expect(sig).toMatchObject({
      sourceId: claim.sourceId,
      payload: { type: 'offer', sdp: 'v=0 real' },
    });

    studio.ws.send(
      JSON.stringify({
        type: 'signal',
        sourceId: claim.sourceId,
        payload: { type: 'answer', sdp: 'v=0 ans' },
      }),
    );
    expect(await cam.next('signal')).toMatchObject({ payload: { type: 'answer' } });

    studio.ws.send(JSON.stringify({ type: 'tally', sourceId: claim.sourceId, state: 'live' }));
    expect(await cam.next('tally')).toMatchObject({ state: 'live' });

    // revoke closes the camera socket within 5 s (A12)
    const closed = new Promise<number>((r) => cam.ws.on('close', (code) => r(code)));
    await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${s.id}/sources/${claim.sourceId}`,
      headers,
    });
    expect(await cam.next('revoke')).toBeTruthy();
    expect(await closed).toBe(4403);

    // the revoked credential cannot reconnect
    const again = await open(undefined);
    const closed2 = new Promise<number>((r) => again.ws.on('close', (code) => r(code)));
    again.ws.send(JSON.stringify({ type: 'hello', role: 'camera', credential: adm.credential }));
    expect(await closed2).toBe(4403);
    studio.ws.close();
  });

  it('refuses studio hello without an operator cookie and sockets from other origins', async () => {
    const anon = await open(undefined);
    const closed = new Promise<number>((r) => anon.ws.on('close', (c) => r(c)));
    anon.ws.send(
      JSON.stringify({
        type: 'hello',
        role: 'studio',
        sessionId: crypto.randomUUID(),
        clientId: crypto.randomUUID(),
      }),
    );
    expect(await closed).toBe(4401);

    const evil = await open(cookieHeader, 'https://evil.test');
    expect(await new Promise<number>((r) => evil.ws.on('close', (c) => r(c)))).toBe(4403);
  });

  it('drops malformed and oversized messages and closes floods', async () => {
    const s = await open(cookieHeader);
    const closed = new Promise<number>((r) => s.ws.on('close', (c) => r(c)));
    for (let i = 0; i < 12; i++) s.ws.send('{not json');
    expect(await closed).toBe(4400);
  });
});
