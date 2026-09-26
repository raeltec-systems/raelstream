import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../src/db.js';
import { appWithOperator, freshDb } from './helpers.js';

let db: Kysely<DB>;
let app: FastifyInstance;
let owner: Record<string, string>;
let sid: string;

beforeAll(async () => {
  const f = await freshDb('rs_test_observability');
  db = f.db;
  ({ app, headers: owner } = await appWithOperator(db, f.url));
  sid = (
    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: owner,
      payload: { name: 'Sunday' },
    })
  ).json().id;
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const call = (method: string, url: string, payload?: unknown) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: owner,
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

const stat = (avg: number | null) => ({ min: avg, avg, max: avg });
const window = (start: string, fps: number | null) => ({
  windowStart: start,
  windowS: 10,
  metrics: {
    cameraFps: stat(fps),
    cameraLossPct: stat(0.2),
    cameraRttMs: stat(null),
    jitterBufferMs: stat(null),
    uploadMbps: stat(null),
    uploadRttMs: stat(null),
    encodeFps: stat(null),
    qualityLimitation: {},
    audioPeakMaxDb: -12,
    clips: 0,
    silenceS: 0,
    qualitySteps: { upload: 0, cpu: 0, camera: 0 },
  },
});

describe('report (SPEC §19, A45)', () => {
  it('says "Not tested" and "unavailable" when nothing was measured, never a green default', async () => {
    const r = (await call('GET', `/api/sessions/${sid}/report`)).json();
    const status = Object.fromEntries(
      r.checks.map((c: { name: string; status: string }) => [c.name, c.status]),
    );
    expect(status).toMatchObject({
      'Uplink test': 'Not tested',
      'Lip-sync calibration': 'Not tested',
      'Camera frame rate (≥ 24 fps average)': 'Not tested',
      'Private recording': 'Not tested',
      'Service ended as planned': 'Inconclusive',
    });
    expect(r.stats.cameraFps).toBeNull();
    expect(Object.values(status)).not.toContain('Passed');
  });

  it('aggregates the studio windows; browser-missing fields stay unavailable', async () => {
    for (const [i, fps] of [30, 29, 14].entries())
      expect(
        (
          await call(
            'POST',
            `/api/sessions/${sid}/diagnostics`,
            window(new Date(Date.UTC(2026, 8, 27, 9, 0, i * 10)).toISOString(), fps),
          )
        ).statusCode,
      ).toBe(200);
    // A replayed window is ignored.
    await call(
      'POST',
      `/api/sessions/${sid}/diagnostics`,
      window(new Date(Date.UTC(2026, 8, 27, 9, 0, 0)).toISOString(), 1),
    );
    const r = (await call('GET', `/api/sessions/${sid}/report`)).json();
    expect(r.stats.cameraFps).toEqual({ min: 14, avg: 24.3, max: 30, windows: 3 });
    expect(r.stats.uploadMbps).toBeNull();
    const fps = r.checks.find((c: { name: string }) => c.name.startsWith('Camera frame rate'));
    expect(fps).toMatchObject({ status: 'Passed' });
    // Unknown fields are refused rather than stored.
    const bad = window(new Date().toISOString(), 30) as { metrics: Record<string, unknown> };
    bad.metrics.ipAddress = '10.0.0.1';
    expect((await call('POST', `/api/sessions/${sid}/diagnostics`, bad)).statusCode).toBe(400);
  });

  it('records only known studio events, and shows quality changes in the report', async () => {
    expect(
      (
        await call('POST', `/api/sessions/${sid}/events`, {
          kind: 'quality.upload_reduced',
          data: { mbps: 4.5 },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call('POST', `/api/sessions/${sid}/events`, { kind: 'anything.else' })).statusCode,
    ).toBe(400);
    const r = (await call('GET', `/api/sessions/${sid}/report`)).json();
    expect(r.qualityChanges).toEqual([
      expect.objectContaining({ kind: 'quality.upload_reduced', data: { mbps: 4.5 } }),
    ]);
  });
});

describe('grace extension (SPEC §12.5)', () => {
  it('only while recovering, 5 minutes at a time, at most 20 minutes', async () => {
    expect((await call('POST', `/api/sessions/${sid}/grace/extend`)).statusCode).toBe(409);
    const desired = {
      generation: 1,
      mode: 'live',
      profile: 'reliable_hd',
      normaliser: 'running',
      publishers: {},
      fallbackGraceS: 600,
      stopRequestedAt: null,
      endOnStop: true,
    };
    await db
      .updateTable('stream_sessions')
      .set({ lifecycle: 'RECOVERING', desired_state: JSON.stringify(desired) })
      .where('id', '=', sid)
      .execute();
    const seen: number[] = [];
    for (let i = 0; i < 3; i++)
      seen.push((await call('POST', `/api/sessions/${sid}/grace/extend`)).json().fallbackGraceS);
    expect(seen).toEqual([900, 1200, 1200]);
  });
});

describe('recent services', () => {
  it('lists ended services with their outcome', async () => {
    await db
      .updateTable('stream_sessions')
      .set({ lifecycle: 'INTERRUPTED', ended_at: new Date() })
      .where('id', '=', sid)
      .execute();
    const r = (await call('GET', '/api/sessions/recent')).json();
    expect(r[0]).toMatchObject({ id: sid, lifecycle: 'INTERRUPTED' });
    const report = (await call('GET', `/api/sessions/${sid}/report`)).json();
    expect(
      report.checks.find((c: { name: string }) => c.name === 'Service ended as planned').status,
    ).toBe('Failed');
  });
});
