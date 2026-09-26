import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { DesiredState, ObservedState } from '@raelstream/contracts';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { AppError } from '../errors.js';
import { operatorOf, requireUser, type AuthService } from '../auth.js';
import * as sessions from '../sessions.js';
import { notifyDesired } from '../media.js';
import type { Hub } from '../hub.js';
import { RECORDING_RETENTION_MS, listRecordings } from './recordings.js';

const IdParams = z.object({ id: z.string().uuid() });

/** Studio-side events the report shows (SPEC §19). Anything else is refused. */
const STUDIO_EVENTS: Record<string, 'info' | 'warn' | 'critical'> = {
  'quality.upload_reduced': 'warn',
  'quality.upload_restored': 'info',
  'quality.cpu_reduced': 'warn',
  'quality.cpu_restored': 'info',
  'quality.camera_reduced': 'warn',
  'quality.camera_restored': 'info',
  'studio.hidden': 'info',
  'camera.auto_slate': 'critical',
  'audio.device_lost': 'critical',
  'audio.silent': 'warn',
};

const Stat = z
  .object({ min: z.number().nullable(), avg: z.number().nullable(), max: z.number().nullable() })
  .strict();
/** One 10-second window of studio statistics. Missing browser fields stay null, never 0. */
export const DiagnosticWindow = z.object({
  windowStart: z.string().datetime(),
  windowS: z.number().int().min(1).max(60),
  metrics: z
    .object({
      cameraFps: Stat,
      cameraLossPct: Stat,
      cameraRttMs: Stat,
      jitterBufferMs: Stat,
      uploadMbps: Stat,
      uploadRttMs: Stat,
      encodeFps: Stat,
      qualityLimitation: z.record(z.string().max(20), z.number().int()).optional(),
      audioPeakMaxDb: z.number().nullable(),
      clips: z.number().int().min(0),
      silenceS: z.number().min(0),
      qualitySteps: z.object({ upload: z.number(), cpu: z.number(), camera: z.number() }),
    })
    .strict(),
});
export type DiagnosticWindow = z.infer<typeof DiagnosticWindow>;

type CheckStatus = 'Passed' | 'Failed' | 'Not tested' | 'Inconclusive';
interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

function agg(windows: DiagnosticWindow['metrics'][], key: keyof DiagnosticWindow['metrics']) {
  const vals = windows
    .map((w) => (w[key] as { min: number | null; avg: number | null; max: number | null }) ?? null)
    .filter((s): s is { min: number | null; avg: number | null; max: number | null } => !!s);
  const mins = vals.map((v) => v.min).filter((v): v is number => v !== null);
  const avgs = vals.map((v) => v.avg).filter((v): v is number => v !== null);
  const maxs = vals.map((v) => v.max).filter((v): v is number => v !== null);
  if (!avgs.length) return null; // unavailable, never 0 (A45)
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    min: r(Math.min(...mins)),
    avg: r(avgs.reduce((a, b) => a + b, 0) / avgs.length),
    max: r(Math.max(...maxs)),
    windows: avgs.length,
  };
}

/** The service report (S06, SPEC §19). Redacted: no keys, tokens, SDP or IP addresses. */
export async function buildReport(db: Kysely<DB>, cfg: Config, sessionId: string) {
  const s = await sessions.getSession(db, sessionId);
  const desired = DesiredState.safeParse(s.desired_state);
  const observed = ObservedState.safeParse(s.observed_state);
  const events = await db
    .selectFrom('session_events')
    .select(['sequence', 'kind', 'severity', 'actor', 'occurred_at', 'payload'])
    .where('session_id', '=', sessionId)
    .orderBy('sequence')
    .execute();
  const dests = await db
    .selectFrom('session_destinations')
    .innerJoin('destinations', 'destinations.id', 'session_destinations.destination_id')
    .select([
      'destinations.id',
      'destinations.platform',
      'destinations.label',
      'session_destinations.live_confirmation',
    ])
    .where('session_destinations.session_id', '=', sessionId)
    .execute();
  const windows = (
    await db
      .selectFrom('diagnostic_summaries')
      .select('metrics')
      .where('session_id', '=', sessionId)
      .orderBy('window_start')
      .execute()
  ).map((w) => w.metrics as unknown as DiagnosticWindow['metrics']);
  const calibration = await db
    .selectFrom('sync_calibrations')
    .select(['offset_ms', 'measured_offset_ms', 'result', 'measured_at', 'audio_device_label'])
    .where('session_id', '=', sessionId)
    .orderBy('measured_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  const recordings = (await listRecordings(cfg, sessionId)).map((r) => ({
    ...r,
    expiresAt: new Date(Date.parse(r.modifiedAt) + RECORDING_RETENTION_MS).toISOString(),
  }));
  const uplink = s.uplink_test as { httpMbps?: number; offer?: string } | null;
  const live = desired.success && desired.data.mode === 'live';
  const obsDests = observed.success ? observed.data.destinations : {};

  const stats = {
    cameraFps: agg(windows, 'cameraFps'),
    cameraLossPct: agg(windows, 'cameraLossPct'),
    cameraRttMs: agg(windows, 'cameraRttMs'),
    jitterBufferMs: agg(windows, 'jitterBufferMs'),
    uploadMbps: agg(windows, 'uploadMbps'),
    uploadRttMs: agg(windows, 'uploadRttMs'),
    encodeFps: agg(windows, 'encodeFps'),
    clips: windows.length ? windows.reduce((a, w) => a + w.clips, 0) : null,
    silenceS: windows.length ? windows.reduce((a, w) => a + w.silenceS, 0) : null,
  };

  const checks: Check[] = [
    uplink?.offer
      ? {
          name: 'Uplink test',
          status: uplink.offer === 'insufficient' ? 'Failed' : 'Passed',
          detail: `${uplink.httpMbps} Mb/s (${uplink.offer})`,
        }
      : { name: 'Uplink test', status: 'Not tested', detail: 'Upload not measured' },
    calibration
      ? {
          name: 'Lip-sync calibration',
          status: calibration.result === 'ok' ? 'Passed' : 'Failed',
          detail:
            calibration.result === 'ok'
              ? `${calibration.offset_ms} ms applied`
              : 'Audio arrives later than video',
        }
      : {
          name: 'Lip-sync calibration',
          status: 'Not tested',
          detail: 'No clip check this service',
        },
    stats.cameraFps
      ? {
          name: 'Camera frame rate (≥ 24 fps average)',
          status: stats.cameraFps.avg >= 24 ? 'Passed' : 'Failed',
          detail: `avg ${stats.cameraFps.avg}, min ${stats.cameraFps.min} fps`,
        }
      : {
          name: 'Camera frame rate (≥ 24 fps average)',
          status: 'Not tested',
          detail: 'unavailable',
        },
    !live || dests.length === 0
      ? {
          name: 'Live on every platform (operator check)',
          status: 'Not tested',
          detail: 'Not live',
        }
      : {
          name: 'Live on every platform (operator check)',
          status: dests.every((d) => d.live_confirmation) ? 'Passed' : 'Inconclusive',
          detail: dests
            .map((d) => `${d.label}: ${d.live_confirmation ? 'checked' : 'not checked'}`)
            .join('; '),
        },
    ['ENDED', 'INTERRUPTED'].includes(s.lifecycle)
      ? {
          name: 'Service ended as planned',
          status: s.lifecycle === 'ENDED' ? 'Passed' : 'Failed',
          detail: s.end_reason ?? s.lifecycle,
        }
      : { name: 'Service ended as planned', status: 'Inconclusive', detail: s.lifecycle },
    desired.success && desired.data.record
      ? {
          name: 'Private recording',
          status: recordings.length ? 'Passed' : 'Failed',
          detail: recordings.length ? `${recordings.length} files` : 'No files were written',
        }
      : { name: 'Private recording', status: 'Not tested', detail: 'Not requested' },
  ];

  return {
    service: {
      id: s.id,
      name: s.name,
      lifecycle: s.lifecycle,
      mode: s.mode,
      profile: s.profile,
      createdAt: new Date(s.created_at as unknown as string).toISOString(),
      startedAt: s.started_at ? new Date(s.started_at as unknown as string).toISOString() : null,
      endedAt: s.ended_at ? new Date(s.ended_at as unknown as string).toISOString() : null,
      endReason: s.end_reason,
    },
    checks,
    destinations: dests.map((d) => ({
      platform: d.platform,
      label: d.label,
      finalState: obsDests[d.id]?.state ?? 'unknown',
      reconnects: obsDests[d.id]?.attempts ?? null,
      failure: obsDests[d.id]?.failure ?? null,
      liveConfirmation: d.live_confirmation
        ? { by: d.live_confirmation.by, at: d.live_confirmation.at }
        : null,
    })),
    stats,
    uplink,
    calibration,
    qualityChanges: events
      .filter((e) => e.kind.startsWith('quality.'))
      .map((e) => ({ at: e.occurred_at, kind: e.kind, data: e.payload })),
    recordings,
    timeline: events.map((e) => ({
      at: e.occurred_at,
      kind: e.kind,
      severity: e.severity,
      actor: e.actor,
    })),
  };
}

/** Events, statistics, the grace extension and the report (SPEC §12.5, §19). */
export function registerObservabilityRoutes(
  app: FastifyInstance,
  cfg: Config,
  db: Kysely<DB>,
  auth: AuthService,
  hub: Hub,
  lease: (req: FastifyRequest, sessionId: string) => Promise<void>,
): void {
  const user = requireUser(auth, cfg.allowedOrigins);

  app.post('/api/sessions/:id/events', { preHandler: user }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await lease(req, id);
    const { kind, data } = z
      .object({ kind: z.string().max(40), data: z.record(z.string(), z.unknown()).default({}) })
      .parse(req.body);
    const severity = STUDIO_EVENTS[kind];
    if (!severity) throw new AppError('VALIDATION');
    if (JSON.stringify(data).length > 1000) throw new AppError('VALIDATION');
    const ev = await sessions.appendEvent(db, id, kind, severity, operatorOf(req).name, data);
    hub.broadcastEvent(id, ev);
    return { ok: true };
  });

  app.post('/api/sessions/:id/diagnostics', { preHandler: user }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await lease(req, id);
    const w = DiagnosticWindow.parse(req.body);
    await db
      .insertInto('diagnostic_summaries')
      .values({
        session_id: id,
        window_start: w.windowStart,
        window_s: w.windowS,
        metrics: JSON.stringify(w.metrics),
      })
      .onConflict((oc) => oc.columns(['session_id', 'window_start']).doNothing())
      .execute();
    return { ok: true };
  });

  /**
   * Keep the slate up longer while the studio comes back (SPEC §12.5): +5 min per press, at most
   * 20 min in total. Only while the service is recovering.
   */
  app.post('/api/sessions/:id/grace/extend', { preHandler: user }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await lease(req, id);
    const s = await sessions.getSession(db, id);
    const d = DesiredState.safeParse(s.desired_state);
    if (s.lifecycle !== 'RECOVERING' || !d.success) throw new AppError('NOT_SENDING');
    const fallbackGraceS = Math.min(1200, d.data.fallbackGraceS + 300);
    await db
      .updateTable('stream_sessions')
      .set({ desired_state: JSON.stringify({ ...d.data, fallbackGraceS }) })
      .where('id', '=', id)
      .execute();
    await notifyDesired(db, id);
    const ev = await sessions.appendEvent(db, id, 'grace.extended', 'warn', operatorOf(req).name, {
      fallbackGraceS,
    });
    hub.broadcastEvent(id, ev);
    return { fallbackGraceS };
  });

  app.get('/api/sessions/:id/report', { preHandler: user }, async (req) =>
    buildReport(db, cfg, IdParams.parse(req.params).id),
  );

  /** Recent services for the home screen, newest first, with their outcome. */
  app.get('/api/sessions/recent', { preHandler: user }, async () => {
    const rows = await db
      .selectFrom('stream_sessions')
      .select(['id', 'name', 'lifecycle', 'created_at', 'started_at', 'ended_at', 'end_reason'])
      .where('lifecycle', 'in', ['ENDED', 'INTERRUPTED'])
      .orderBy('created_at', 'desc')
      .limit(10)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      lifecycle: r.lifecycle,
      createdAt: new Date(r.created_at as unknown as string).toISOString(),
      endedAt: r.ended_at ? new Date(r.ended_at as unknown as string).toISOString() : null,
      endReason: r.end_reason,
      wasLive: !!r.started_at,
    }));
  });
}
