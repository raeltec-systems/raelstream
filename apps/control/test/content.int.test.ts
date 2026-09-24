import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { DB } from '../src/db.js';
import type { AuthService } from '../src/auth.js';
import { appWithOperator, createTestUser, freshDb, signIn } from './helpers.js';

let db: Kysely<DB>;
let app: FastifyInstance;
let auth: AuthService;
let owner: Record<string, string>;
let operator: Record<string, string>;

beforeAll(async () => {
  const f = await freshDb('rs_test_content');
  db = f.db;
  ({ app, auth, headers: owner } = await appWithOperator(db, f.url));
  const op = await createTestUser(auth, 'op@church.test', 'operator', 'Mwila');
  ({ headers: operator } = await signIn(app, op));
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const upload = (body: Buffer, type = 'image/png', headers = owner) =>
  app.inject({
    method: 'POST',
    url: '/api/assets',
    headers: { ...headers, 'content-type': type },
    payload: body,
  });

const solid = (w: number, h: number, alpha: boolean) =>
  sharp({
    create: {
      width: w,
      height: h,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 200, g: 30, b: 30, alpha: 0.5 } : { r: 30, g: 90, b: 200 },
    },
  });

describe('assets (SPEC §10.6, A24)', () => {
  it('keeps transparency as PNG and serves it same-origin, cacheable, signed-in only', async () => {
    const r = await upload(await solid(300, 120, true).png().toBuffer());
    expect(r.statusCode).toBe(200);
    const a = r.json();
    expect(a).toMatchObject({ mime: 'image/png', width: 300, height: 120 });
    const g = await app.inject({ method: 'GET', url: `/api/assets/${a.id}`, headers: owner });
    expect(g.statusCode).toBe(200);
    expect(g.headers['content-type']).toBe('image/png');
    expect(g.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(g.headers['cross-origin-resource-policy']).toBe('same-origin');
    const anon = await app.inject({ method: 'GET', url: `/api/assets/${a.id}` });
    expect(anon.statusCode).toBe(401);
  });

  it('re-encodes photos as JPEG without metadata (GPS stripped), whatever type was declared', async () => {
    const withExif = await solid(640, 480, false)
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-location' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const r = await upload(withExif, 'application/octet-stream');
    expect(r.statusCode).toBe(200);
    expect(r.json().mime).toBe('image/jpeg');
    const g = await app.inject({
      method: 'GET',
      url: `/api/assets/${r.json().id}`,
      headers: owner,
    });
    const meta = await sharp(g.rawPayload).metadata();
    expect(meta.exif).toBeUndefined();
    expect(g.rawPayload.includes(Buffer.from('secret-location'))).toBe(false);
  });

  it('accepts WebP and deduplicates identical uploads', async () => {
    const webp = await solid(200, 200, false).webp().toBuffer();
    const a = (await upload(webp, 'image/webp')).json();
    const b = (await upload(webp, 'image/webp')).json();
    expect(a.id).toBe(b.id);
  });

  it('refuses SVG, text renamed as PNG, damaged images, animations and oversize images', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');
    expect((await upload(svg, 'image/png')).json().code).toBe('ASSET_UNSUPPORTED');
    expect((await upload(svg, 'image/svg+xml')).json().code).toBe('ASSET_UNSUPPORTED');
    const good = await solid(400, 300, false).jpeg().toBuffer();
    const damaged = good.subarray(0, 200);
    const d = await upload(damaged, 'image/jpeg');
    expect(d.statusCode).toBe(422);
    expect(d.json().code).toBe('ASSET_CORRUPT');
    const red = await solid(40, 40, false).png().toBuffer();
    const blue = await solid(40, 40, true).png().toBuffer();
    const animated = await sharp([red, blue], { join: { animated: true } })
      .webp({ loop: 0 })
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    expect((await upload(animated, 'image/webp')).json().code).toBe('ASSET_UNSUPPORTED');
    const huge = await solid(4200, 10, false).png().toBuffer();
    const h = await upload(huge);
    expect(h.statusCode).toBe(413);
    expect(h.json().code).toBe('ASSET_TOO_LARGE');
    const big = Buffer.concat([good, Buffer.alloc(11 * 1024 * 1024)]);
    const b = await upload(big, 'image/jpeg');
    expect(b.statusCode).toBe(413);
    expect(b.json().code).toBe('ASSET_TOO_LARGE');
  });

  it('needs the CSRF header like every other change', async () => {
    const png = await solid(10, 10, true).png().toBuffer();
    const { 'x-rs-csrf': _csrf, ...noCsrf } = owner;
    expect((await upload(png, 'image/png', noCsrf)).statusCode).toBe(403);
  });
});

describe('church theme (SPEC §10.5)', () => {
  it('returns defaults, saves a valid theme, and refuses unreadable colours', async () => {
    const d = await app.inject({ method: 'GET', url: '/api/theme', headers: owner });
    expect(d.json()).toMatchObject({ font: 'inter', logoAssetId: null, logoCorner: 'tr' });
    const logo = (await upload(await solid(200, 200, true).png().toBuffer())).json();
    const put = (payload: Record<string, unknown>, headers = owner) =>
      app.inject({ method: 'PUT', url: '/api/theme', headers, payload });
    const ok = await put({
      churchName: 'Grace Chapel',
      logoAssetId: logo.id,
      logoCorner: 'bl',
      logoScale: 0.1,
      primaryColor: '#7A1F2B',
      font: 'atkinson',
    });
    expect(ok.statusCode).toBe(200);
    const saved = (
      await app.inject({ method: 'GET', url: '/api/theme', headers: operator })
    ).json();
    expect(saved).toMatchObject({ churchName: 'Grace Chapel', logoCorner: 'bl', font: 'atkinson' });

    const pale = await put({ primaryColor: '#FFE680' });
    expect(pale.statusCode).toBe(400);
    expect(pale.json().code).toBe('THEME_CONTRAST');
    expect((await put({ logoScale: 0.5 })).statusCode).toBe(400);
    expect((await put({ logoAssetId: crypto.randomUUID() })).statusCode).toBe(404);
    expect((await put({ primaryColor: '#7A1F2B' }, operator)).statusCode).toBe(403);
  });
});
