import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../src/db.js';
import { DEVICE, ORIGIN, appWithOperator, freshDb } from './helpers.js';

let db: Kysely<DB>;
let app: FastifyInstance;
let headers: Record<string, string>;
let base: string;

beforeAll(async () => {
  const f = await freshDb('rs_test_cam_recovery');
  db = f.db;
  ({ app, headers } = await appWithOperator(db, f.url));
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/ws`;
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

/** Open a camera socket, say hello, and return the first message or the close code. */
function hello(credential: string): Promise<{ msgs: Record<string, unknown>[]; close?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(base, { headers: { origin: ORIGIN } });
    const msgs: Record<string, unknown>[] = [];
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'camera', credential })));
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.on('close', (code) => resolve({ msgs, close: code }));
    setTimeout(() => {
      ws.close();
      resolve({ msgs });
    }, 600);
  });
}

describe('camera admission recovery', () => {
  it('a phone whose socket was down when it was admitted still gets in, once', async () => {
    const s = (
      await app.inject({ method: 'POST', url: '/api/sessions', headers, payload: { name: 'Rec' } })
    ).json();
    const inv = (
      await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/pairings`, headers })
    ).json();
    const claim = (
      await app.inject({
        method: 'POST',
        url: '/api/pairings/claim',
        payload: { token: inv.url.split('#t=')[1], deviceId: DEVICE, label: 'Camera 1' },
      })
    ).json();
    const pending = claim.credential as string;

    // Admitted while the phone is offline: the "admitted" message is lost.
    const adm = await app.inject({
      method: 'POST',
      url: `/api/sessions/${s.id}/sources/${claim.sourceId}/admit`,
      headers,
    });
    expect(adm.statusCode).toBe(200);

    // The phone reconnects with its pending credential and receives a fresh one.
    const r1 = await hello(pending);
    expect(r1.close).toBeUndefined();
    expect(r1.msgs[0]).toMatchObject({ type: 'welcome', sourceStatus: 'admitted' });
    const again = r1.msgs.find((m) => m.type === 'admitted');
    expect(again?.credential).toEqual(expect.any(String));

    // The pending credential worked once only; the new one works.
    expect((await hello(pending)).close).toBe(4403);
    const r2 = await hello(again!.credential as string);
    expect(r2.msgs[0]).toMatchObject({ type: 'welcome', sourceStatus: 'admitted' });
  });

  it('the pending credential is not accepted after the recovery window', async () => {
    const src = await db
      .selectFrom('camera_sources')
      .select(['id', 'session_id'])
      .where('status', '=', 'admitted')
      .executeTakeFirstOrThrow();
    // Revoke and re-pair to get a fresh pending credential, then expire its window.
    await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${src.session_id}/sources/${src.id}`,
      headers,
    });
    const inv = (
      await app.inject({ method: 'POST', url: `/api/sessions/${src.session_id}/pairings`, headers })
    ).json();
    const claim = (
      await app.inject({
        method: 'POST',
        url: '/api/pairings/claim',
        payload: { token: inv.url.split('#t=')[1], deviceId: DEVICE, label: 'Camera 1' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${src.session_id}/sources/${claim.sourceId}/admit`,
      headers,
    });
    await db
      .updateTable('camera_sources')
      .set({ pending_valid_until: new Date(Date.now() - 1000) })
      .where('id', '=', claim.sourceId)
      .execute();
    expect((await hello(claim.credential)).close).toBe(4403);
  });
});
