import { mkdtemp, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { ObservedState } from '@raelstream/contracts';
import { generateKeypair, seal } from '@raelstream/secrets';
import type { DB } from '../../control/src/db.js';
import { buildApp } from '../../control/src/app.js';
import { freshDb, testConfig, createTestUser, signIn } from '../../control/test/helpers.js';
import { MEDIAMTX_IMAGE, SUPERVISOR_IMAGE, docker, inImage, logs, rm } from './docker.js';
import { avOffsetsMs, beepOnsets, flashTimes, keyframeTimes, probe, videoPts } from './analysis.js';

/**
 * M2 media-node evidence (PLAN §2): real FFmpeg 8.1.2 (supervisor image), real MediaMTX, two local RTMP
 * "platforms". Synthetic contribution with a white flash + 1 kHz beep every 2 s for sync measurement.
 */
const C = {
  mtx: 'rs-m-mediamtx',
  sinkA: 'rs-m-sink-a',
  sinkB: 'rs-m-sink-b',
  sup: 'rs-m-supervisor',
  gen: 'rs-m-generator',
  rec: 'rs-m-rec',
};
const DB_NAME = 'rs_media';
const KEY_A = 'fb-test-key-123';
const KEY_B = 'yt-test-key-456';
const auth = 'Basic ' + Buffer.from('supervisor:dev-internal').toString('base64');

let db: Kysely<DB>;
let app: FastifyInstance;
let headers: Record<string, string>;
let sessionId: string;
let bearer: string;
let generation = 1;
let destA: string;
let destB: string;
let work: string;
let slates: string;

const REPO = new URL('../../../', import.meta.url).pathname;
const evidence: Record<string, unknown> = {
  recordedAt: new Date().toISOString(),
  ffmpeg: '8.1.2 (bluenviron/mediamtx:1.21.1-ffmpeg)',
  mediamtx: '1.21.1',
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 30_000,
  everyMs = 500,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(everyMs);
  }
  throw new Error(
    `timeout: ${what}${last ? ` (${String(last)})` : ''}\n--- supervisor ---\n${await logs(C.sup)}`,
  );
}

async function observed(): Promise<{ lifecycle: string; o: ObservedState | null }> {
  const r = await db
    .selectFrom('stream_sessions')
    .select(['lifecycle', 'observed_state'])
    .where('id', '=', sessionId)
    .executeTakeFirstOrThrow();
  const p = ObservedState.safeParse(r.observed_state);
  return { lifecycle: r.lifecycle, o: p.success ? p.data : null };
}

async function sinkPath(
  api: number,
  path: string,
): Promise<{ ready: boolean; bytesReceived: number; source: { id: string } | null } | null> {
  const r = await fetch(`http://127.0.0.1:${api}/v3/paths/get/${path}`);
  return r.ok ? ((await r.json()) as never) : null;
}

async function startSink(name: string, rtmpPort: number, apiPort: number) {
  await rm(name);
  await docker([
    'run',
    '-d',
    '--name',
    name,
    '--network',
    'host',
    '-v',
    `${REPO}infra/media/test-sink.yml:/mediamtx.yml:ro`,
    '-e',
    `MTX_RTMPADDRESS=:${rtmpPort}`,
    '-e',
    `MTX_APIADDRESS=127.0.0.1:${apiPort}`,
    MEDIAMTX_IMAGE,
  ]);
  await until(
    `${name} api`,
    async () => (await fetch(`http://127.0.0.1:${apiPort}/v3/paths/list`)).ok,
    15_000,
  );
}

async function startGenerator() {
  await rm(C.gen);
  const flash = "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t\\,2)\\,0.034)'";
  const beep =
    "sine=f=1000:r=48000,volume='if(lt(mod(t\\,2)\\,0.1)\\,1\\,0)':eval=frame,pan=stereo|c0=c0|c1=c0";
  await docker([
    'run',
    '-d',
    '--name',
    C.gen,
    '--network',
    'host',
    '--entrypoint',
    'ffmpeg',
    SUPERVISOR_IMAGE,
    '-hide_banner',
    '-loglevel',
    'error',
    '-re',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=960x540:r=30,${flash}`,
    '-f',
    'lavfi',
    '-i',
    beep,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-g',
    '60',
    '-bf',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    '2M',
    '-c:a',
    'libopus',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-f',
    'rtsp',
    '-rtsp_transport',
    'tcp',
    `rtsp://any:${bearer}@127.0.0.1:8554/live/${sessionId}/g${generation}/contrib`,
  ]);
}

async function record(file: string, seconds: number, path = `fb/${KEY_A}`, port = 1935) {
  await inImage(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-rw_timeout',
      '10000000',
      '-i',
      `rtmp://127.0.0.1:${port}/${path}`,
      '-t',
      String(seconds),
      '-c',
      'copy',
      '-y',
      `/work/${file}`,
    ],
    work,
    (seconds + 30) * 1000,
  );
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'rs-media-'));
  slates = await mkdtemp(join(tmpdir(), 'rs-slates-'));
  await chmod(work, 0o777);
  await chmod(slates, 0o777);
  const f = await freshDb(DB_NAME);
  db = f.db;
  const kp = await generateKeypair();
  const cfg = { ...testConfig(f.url), sealPublicKey: kp.publicKey };
  const built = await buildApp(cfg, db);
  app = built.app;
  await app.listen({ port: 3000, host: '127.0.0.1' });
  const owner = await createTestUser(built.auth, 'owner@media.test', 'owner', 'Chanda');
  ({ headers } = await signIn(app, owner));

  destA = (
    await db
      .insertInto('destinations')
      .values({
        platform: 'facebook',
        label: 'Facebook Page',
        server_url: 'rtmp://127.0.0.1:1935/fb',
        key_enc: await seal(kp.publicKey, KEY_A),
        key_last4: '-123',
        key_mode: 'persistent',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  destB = (
    await db
      .insertInto('destinations')
      .values({
        platform: 'youtube',
        label: 'YouTube',
        server_url: 'rtmp://127.0.0.1:1936/yt',
        key_enc: await seal(kp.publicKey, KEY_B),
        key_last4: '-456',
        key_mode: 'persistent',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  sessionId = (
    await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers,
      payload: { name: 'Media test' },
    })
  ).json().id;
  await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/mode`,
    headers,
    payload: { mode: 'ingest_test' },
  });
  bearer = (
    await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/ingest`, headers })
  ).json().bearer;

  await rm(...Object.values(C));
  await docker([
    'run',
    '-d',
    '--name',
    C.mtx,
    '--network',
    'host',
    '-v',
    `${REPO}infra/media/mediamtx.yml:/mediamtx.yml:ro`,
    '-v',
    `${slates}:/var/lib/raelstream/slates:ro`,
    '-e',
    'MTX_AUTHHTTPADDRESS=http://127.0.0.1:3000/internal/mediamtx/auth',
    '-e',
    'MTX_WEBRTCLOCALTCPADDRESS=',
    '-e',
    'MTX_RTMPADDRESS=127.0.0.1:1945',
    MEDIAMTX_IMAGE,
  ]);
  await startSink(C.sinkA, 1935, 9998);
  await startSink(C.sinkB, 1936, 9999);
  await until(
    'mediamtx api',
    async () =>
      (await fetch('http://127.0.0.1:9997/v3/paths/list', { headers: { Authorization: auth } })).ok,
    15_000,
  );
  await docker([
    'run',
    '-d',
    '--name',
    C.sup,
    '--network',
    'host',
    '-v',
    `${slates}:/var/lib/raelstream/slates`,
    '-e',
    `DATABASE_URL=${f.url.replace('localhost', '127.0.0.1')}`,
    '-e',
    'NODE_ENV=test',
    '-e',
    'RS_DEST_TEST_SINKS=1',
    '-e',
    'MEDIAMTX_RTMP=rtmp://127.0.0.1:1945',
    '-e',
    `RS_SEAL_PUBLIC_KEY=${kp.publicKey}`,
    '-e',
    `RS_SEAL_SECRET_KEY=${kp.secretKey}`,
    SUPERVISOR_IMAGE,
  ]);
  await startGenerator();
}, 180_000);

afterAll(async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(`${REPO}test-results`, { recursive: true });
  await writeFile(`${REPO}test-results/m2-media-evidence.json`, JSON.stringify(evidence, null, 2));
  if (!process.env.RS_MEDIA_KEEP) await rm(...Object.values(C));
  await app?.close();
  await db?.destroy();
});

describe('media node (M2)', () => {
  it('private ingest test runs the normaliser without any publisher', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/start`,
      headers,
      payload: { mode: 'ingest_test', profile: 'reliable_hd', destinationIds: [] },
    });
    expect(r.statusCode).toBe(200);
    const o = await until(
      'normaliser running',
      async () => {
        const x = await observed();
        return x.o?.normaliser.state === 'running' ? x : null;
      },
      40_000,
    );
    expect(o.lifecycle).toBe('PREPARING');
    expect(Object.keys(o.o!.destinations)).toHaveLength(0);
    expect(await sinkPath(9998, `fb/${KEY_A}`)).toBeNull();
  });

  it('upgrades to live with two destinations; a repeated Start is idempotent (A32)', async () => {
    const body = { mode: 'live', profile: 'reliable_hd', destinationIds: [destA, destB] };
    const key = crypto.randomUUID();
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/start`,
        headers: { ...headers, 'idempotency-key': key },
        payload: body,
      }),
      app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/start`,
        headers: { ...headers, 'idempotency-key': key },
        payload: body,
      }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    const o = await until(
      'both sending',
      async () => {
        const x = await observed();
        return x.lifecycle === 'SENDING' &&
          x.o?.destinations[destA]?.state === 'SENDING' &&
          x.o.destinations[destB]?.state === 'SENDING'
          ? x
          : null;
      },
      40_000,
    );
    expect(o.o!.fallback.active).toBe(false);
    expect((await sinkPath(9998, `fb/${KEY_A}`))?.ready).toBe(true);
    expect((await sinkPath(9999, `yt/${KEY_B}`))?.ready).toBe(true);
  });

  it('delivers the fixed profile: H.264 Main 720p30, no B-frames, 2 s keyframes, AAC 44.1 kHz stereo', async () => {
    await record('out.flv', 12);
    const streams = await probe(work, 'out.flv');
    const v = streams.find((s) => s.codec_type === 'video')!;
    const a = streams.find((s) => s.codec_type === 'audio')!;
    expect(v.codec_name).toBe('h264');
    expect(v.profile).toBe('Main');
    expect([v.width, v.height]).toEqual([1280, 720]);
    expect(v.r_frame_rate).toBe('30/1');
    expect(v.pix_fmt).toBe('yuv420p');
    expect(v.has_b_frames).toBe(0);
    expect(a.codec_name).toBe('aac');
    expect(Number(a.sample_rate)).toBe(44100);
    expect(a.channels).toBe(2);
    const kf = await keyframeTimes(work, 'out.flv');
    const gaps = kf.slice(1).map((t, i) => t - kf[i]!);
    expect(gaps.length).toBeGreaterThanOrEqual(4);
    evidence.keyframeGapsS = gaps.map((g) => Number(g.toFixed(3)));
    evidence.outputStreams = {
      video: {
        codec: v.codec_name,
        profile: v.profile,
        width: v.width,
        height: v.height,
        fps: v.r_frame_rate,
        hasBFrames: v.has_b_frames,
      },
      audio: { codec: a.codec_name, rate: a.sample_rate, channels: a.channels },
    };
    for (const g of gaps) expect(g).toBeCloseTo(2, 1);
    const pts = await videoPts(work, 'out.flv');
    for (let i = 1; i < pts.length; i++) expect(pts[i]!).toBeGreaterThan(pts[i - 1]!); // monotonic (B§13.3)
  });

  it('keeps audio and video in sync through the normaliser (±35 ms)', async () => {
    const flashes = await flashTimes(work, 'out.flv');
    const beeps = await beepOnsets(work, 'out.flv');
    const offsets = avOffsetsMs(flashes, beeps);
    evidence.avOffsetsMs = offsets;
    expect(offsets.length).toBeGreaterThanOrEqual(4);
    for (const o of offsets) expect(Math.abs(o)).toBeLessThanOrEqual(35); // ~1 frame; B§13.4 budget is ±80 ms end to end
  });

  it('isolates destinations: losing one platform does not interrupt the other (A28, P-10)', async () => {
    const before = await sinkPath(9998, `fb/${KEY_A}`);
    await rm(C.sinkB);
    const x = await until(
      'B reconnecting, session partial',
      async () => {
        const o = await observed();
        return o.lifecycle === 'PARTIAL' &&
          ['RECONNECTING', 'CONNECTING'].includes(o.o?.destinations[destB]?.state ?? '')
          ? o
          : null;
      },
      30_000,
    );
    expect(x.o!.destinations[destA]!.state).toBe('SENDING');
    try {
      const b1 = (await sinkPath(9998, `fb/${KEY_A}`))!.bytesReceived;
      await sleep(6000);
      const after = (await sinkPath(9998, `fb/${KEY_A}`))!;
      expect(after.source?.id).toBe(before?.source?.id); // same RTMP connection: no reconnect on A
      evidence.isolation = {
        sameConnection: after.source?.id === before?.source?.id,
        otherDestinationKbps: Math.round(((after.bytesReceived - b1) * 8) / 6 / 1000),
      };
      expect(((after.bytesReceived - b1) * 8) / 6).toBeGreaterThan(1_500_000); // A keeps its normal rate (~3.8 Mbit/s target)
    } finally {
      await startSink(C.sinkB, 1936, 9999);
    }
    await until(
      'B back to sending',
      async () => {
        const o = await observed();
        return o.lifecycle === 'SENDING' && o.o?.destinations[destB]?.state === 'SENDING';
      },
      45_000,
    );
  });

  it('switches to the matched fallback slate when the contribution disappears, without reconnecting publishers (A36/A37)', async () => {
    const before = await sinkPath(9998, `fb/${KEY_A}`);
    const lossAt = Date.now();
    await rm(C.gen);
    const x = await until(
      'fallback active',
      async () => {
        const o = await observed();
        return o.lifecycle === 'RECOVERING' && o.o?.fallback.active ? o : null;
      },
      20_000,
    );
    const fallbackDetectS = Math.round((Date.now() - lossAt) / 100) / 10;
    expect(x.o!.fallback.graceEndsAt).not.toBeNull();
    await record('slate.flv', 6);
    const during = await sinkPath(9998, `fb/${KEY_A}`);
    expect(during?.source?.id).toBe(before?.source?.id);
    const s = await probe(work, 'slate.flv');
    expect(s.find((t) => t.codec_type === 'video')?.width).toBe(1280);
    expect(s.find((t) => t.codec_type === 'audio')?.codec_name).toBe('aac');
    expect(await flashTimes(work, 'slate.flv')).toHaveLength(0); // slate, not the stale programme

    const restoreStart = Date.now();
    await startGenerator();
    await until(
      'programme restored',
      async () => {
        const o = await observed();
        return (
          o.lifecycle === 'SENDING' && !o.o?.fallback.active && o.o?.normaliser.state === 'running'
        );
      },
      40_000,
    );
    const after = await sinkPath(9998, `fb/${KEY_A}`);
    evidence.fallback = {
      connectionIds: {
        before: before?.source?.id,
        during: during?.source?.id,
        after: after?.source?.id,
      },
      detectedWithinS: fallbackDetectS,
      restoredWithinS: Math.round((Date.now() - restoreStart) / 100) / 10,
    };
    await record('restored.flv', 8);
    expect((await flashTimes(work, 'restored.flv')).length).toBeGreaterThanOrEqual(2);
    const pts = await videoPts(work, 'restored.flv');
    for (let i = 1; i < pts.length; i++) expect(pts[i]!).toBeGreaterThan(pts[i - 1]!);
  });

  it('a studio takeover mid-broadcast keeps both platforms connected (A33, E37)', async () => {
    const before = await sinkPath(9998, `fb/${KEY_A}`);
    const tabB = { ...headers, 'x-rs-client': crypto.randomUUID() };
    const t = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/takeover`,
      headers: tabB,
    });
    expect(t.json()).toEqual({ generation: 2 });
    headers = tabB;
    // The old tab's contribution goes away; the new tab publishes on the generation-2 path.
    await rm(C.gen);
    generation = 2;
    bearer = (
      await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/ingest`, headers })
    ).json().bearer;
    await startGenerator();
    await until(
      'programme restored on the new generation',
      async () => {
        const o = await observed();
        return (
          o.lifecycle === 'SENDING' &&
          o.o?.generation === 2 &&
          o.o.normaliser.state === 'running' &&
          !o.o.fallback.active
        );
      },
      40_000,
    );
    const after = await sinkPath(9998, `fb/${KEY_A}`);
    expect(after?.source?.id).toBe(before?.source?.id);
    evidence.takeover = { sameConnection: after?.source?.id === before?.source?.id };
  });

  it('stop wins: all processes end, the session ends and tokens are revoked (A34, A48)', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/stop`, headers });
    expect(r.json()).toEqual({ stopping: true });
    const again = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/stop`,
      headers,
    });
    expect(again.statusCode).toBe(200);
    await until('ended', async () => (await observed()).lifecycle === 'ENDED', 20_000);
    const o = await observed();
    expect(o.o!.destinations[destA]!.state).toBe('STOPPED');
    expect(o.o!.destinations[destB]!.state).toBe('STOPPED');
    await until(
      'sinks idle',
      async () =>
        !(await sinkPath(9998, `fb/${KEY_A}`))?.ready &&
        !(await sinkPath(9999, `yt/${KEY_B}`))?.ready,
      15_000,
    );
    const tokens = await db
      .selectFrom('ingest_tokens')
      .select('revoked_at')
      .where('session_id', '=', sessionId)
      .execute();
    expect(tokens.every((t) => t.revoked_at)).toBe(true);
  });

  it('never logs stream keys (A40)', async () => {
    const out = await logs(C.sup);
    expect(out).not.toContain(KEY_A);
    expect(out).not.toContain(KEY_B);
    expect(out).not.toContain('dev-internal');
  });
});
