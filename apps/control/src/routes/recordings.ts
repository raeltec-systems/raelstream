import { createReadStream } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { AppError } from '../errors.js';
import { requireUser, type AuthService } from '../auth.js';

/** 30 days (I-17). */
export const RECORDING_RETENTION_MS = 30 * 24 * 3600_000;

const Params = z.object({ id: z.string().uuid() });
// "<path id>/<segment>.mp4", exactly as MediaMTX names them; nothing else is ever opened.
const FileParams = z.object({
  id: z.string().uuid(),
  dir: z.string().regex(/^[0-9a-f]{32}$/),
  file: z.string().regex(/^[0-9A-Za-z_-]{1,80}\.mp4$/),
});

export interface RecordingFile {
  name: string;
  bytes: number;
  modifiedAt: string;
  url: string;
}

async function listDir(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => []);
}

export async function listRecordings(cfg: Config, sessionId: string): Promise<RecordingFile[]> {
  const base = join(cfg.recordingsDir, 'norm', sessionId);
  const out: RecordingFile[] = [];
  for (const dir of await listDir(base)) {
    if (!/^[0-9a-f]{32}$/.test(dir)) continue;
    for (const file of (await listDir(join(base, dir))).sort()) {
      if (!/\.mp4$/.test(file)) continue;
      const st = await stat(join(base, dir, file)).catch(() => null);
      if (!st?.isFile()) continue;
      out.push({
        name: file,
        bytes: st.size,
        modifiedAt: st.mtime.toISOString(),
        url: `/api/sessions/${sessionId}/recordings/${dir}/${file}`,
      });
    }
  }
  return out;
}

/** Delete recordings older than the retention period (I-17). Returns how many sessions were swept. */
export async function sweepRecordings(cfg: Config, now = Date.now()): Promise<number> {
  const root = join(cfg.recordingsDir, 'norm');
  let swept = 0;
  for (const sid of await listDir(root)) {
    const st = await stat(join(root, sid)).catch(() => null);
    if (st && now - st.mtimeMs > RECORDING_RETENTION_MS) {
      await rm(join(root, sid), { recursive: true, force: true }).catch(() => undefined);
      swept++;
    }
  }
  return swept;
}

/** Owner-only downloads of a service's private recording (SPEC §12.7). */
export function registerRecordingRoutes(
  app: FastifyInstance,
  cfg: Config,
  auth: AuthService,
): void {
  const owner = requireUser(auth, cfg.allowedOrigins, 'owner');

  app.get('/api/sessions/:id/recordings', { preHandler: owner }, async (req) =>
    listRecordings(cfg, Params.parse(req.params).id),
  );

  app.get('/api/sessions/:id/recordings/:dir/:file', { preHandler: owner }, async (req, reply) => {
    const { id, dir, file } = FileParams.parse(req.params);
    const path = join(cfg.recordingsDir, 'norm', id, dir, file);
    const st = await stat(path).catch(() => null);
    if (!st?.isFile()) throw new AppError('NOT_FOUND');
    reply
      .header('Content-Type', 'video/mp4')
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'private, no-store');
    // "?play=1" is for the studio's player; otherwise the browser saves the file.
    if ((req.query as { play?: string }).play !== '1')
      reply.header('Content-Disposition', `attachment; filename="${file}"`);
    // Byte ranges let the player seek without downloading the whole recording first.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end)
        return reply.status(416).header('Content-Range', `bytes */${st.size}`).send();
      return reply
        .status(206)
        .header('Content-Range', `bytes ${start}-${end}/${st.size}`)
        .header('Content-Length', end - start + 1)
        .send(createReadStream(path, { start, end }));
    }
    return reply.header('Content-Length', st.size).send(createReadStream(path));
  });
}
