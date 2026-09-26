import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { DEFAULT_CHURCH_THEME, Theme, primaryReadable } from '@raelstream/contracts';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { AppError } from '../errors.js';
import { ASSET_MAX_BYTES, storeAsset } from '../assets.js';
import { operatorOf, requireUser, type AuthService } from '../auth.js';

const IdParams = z.object({ id: z.string().uuid() });

export const Calibration = z.object({
  sourceFingerprint: z.string().min(1).max(200),
  audioMapping: z.string().min(1).max(40),
  audioDeviceLabel: z.string().max(200),
  profile: z.string().max(40),
  appVersion: z.string().max(40),
  offsetMs: z.number().int().min(0).max(2000),
  measuredOffsetMs: z.number().int().min(-5000).max(5000).nullable(),
  result: z.enum(['ok', 'audio_late']),
});

export async function readTheme(db: Kysely<DB>): Promise<Theme> {
  const v = await db.selectFrom('venue_profile').select('theme').executeTakeFirstOrThrow();
  const parsed = Theme.safeParse(v.theme ?? {});
  return parsed.success ? parsed.data : DEFAULT_CHURCH_THEME;
}

/** Assets (SPEC §10.6), the church theme (§10.5) and sync calibrations (§11.4). */
export function registerContentRoutes(
  app: FastifyInstance,
  cfg: Config,
  db: Kysely<DB>,
  auth: AuthService,
  lease: (req: FastifyRequest, sessionId: string) => Promise<void>,
): void {
  const user = requireUser(auth, cfg.allowedOrigins);
  const owner = requireUser(auth, cfg.allowedOrigins, 'owner');

  // Raw image bodies; the declared type is only a hint, the bytes are sniffed and decoded.
  app.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: ASSET_MAX_BYTES + 1 },
    (_req, body, done) => done(null, body),
  );

  app.post('/api/assets', { preHandler: user, bodyLimit: ASSET_MAX_BYTES + 1 }, async (req) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError('ASSET_UNSUPPORTED');
    return storeAsset(db, req.body, operatorOf(req).userId);
  });

  app.get('/api/assets/:id', { preHandler: user }, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const a = await db
      .selectFrom('assets')
      .select(['mime', 'data'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!a) throw new AppError('NOT_FOUND');
    return reply
      .header('Content-Type', a.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .send(a.data);
  });

  app.get('/api/theme', { preHandler: user }, async () => readTheme(db));

  app.put('/api/theme', { preHandler: owner }, async (req) => {
    const theme = Theme.parse(req.body);
    if (!primaryReadable(theme.primaryColor)) throw new AppError('THEME_CONTRAST');
    for (const id of [theme.logoAssetId, theme.holdingAssetId]) {
      if (!id) continue;
      const found = await db
        .selectFrom('assets')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!found) throw new AppError('NOT_FOUND');
    }
    await db
      .updateTable('venue_profile')
      .set({ theme: JSON.stringify(theme) as never })
      .execute();
    return theme;
  });

  app.post('/api/sessions/:id/calibrations', { preHandler: user }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await lease(req, id);
    const c = Calibration.parse(req.body);
    const row = await db
      .insertInto('sync_calibrations')
      .values({
        session_id: id,
        source_fingerprint: c.sourceFingerprint,
        audio_mapping: c.audioMapping,
        audio_device_label: c.audioDeviceLabel,
        profile: c.profile,
        app_version: c.appVersion,
        offset_ms: c.offsetMs,
        measured_offset_ms: c.measuredOffsetMs,
        result: c.result,
        method: 'clap_clip',
        measured_by: operatorOf(req).userId,
      })
      .returning(['id', 'measured_at'])
      .executeTakeFirstOrThrow();
    return { id: row.id, measuredAt: new Date(row.measured_at as unknown as string).toISOString() };
  });

  /** The latest good calibration, used to show "Calibrated" or "Recheck recommended" (SYNC-04). */
  app.get('/api/calibrations/latest', { preHandler: user }, async () => {
    const r = await db
      .selectFrom('sync_calibrations')
      .selectAll()
      .where('result', '=', 'ok')
      .orderBy('measured_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return r
      ? {
          sourceFingerprint: r.source_fingerprint,
          audioMapping: r.audio_mapping,
          audioDeviceLabel: r.audio_device_label,
          profile: r.profile,
          offsetMs: r.offset_ms,
          measuredAt: new Date(r.measured_at as unknown as string).toISOString(),
        }
      : null;
  });
}
