import { sql, type Kysely } from 'kysely';
import type { SessionEvent, SessionSnapshot, SourceSummary } from '@raelstream/contracts';
import type { DB } from './db.js';
import { AppError } from './errors.js';

/**
 * New session, optionally from a preset: copies the non-secret configuration (rundown, audio defaults,
 * grace period). Destinations are re-reviewed at Go live (B§19.3).
 */
export async function createSession(
  db: Kysely<DB>,
  name: string,
  operator: { name: string; userId: string },
  presetId?: string,
) {
  const preset = presetId
    ? await db
        .selectFrom('presets')
        .selectAll()
        .where('id', '=', presetId)
        .where('archived_at', 'is', null)
        .executeTakeFirst()
    : undefined;
  if (presetId && !preset) throw new AppError('NOT_FOUND', 'session');
  try {
    return await db
      .insertInto('stream_sessions')
      .values({
        name,
        operator_name: operator.name,
        created_by: operator.userId,
        preset_id: preset?.id ?? null,
        ...(preset
          ? {
              rundown: JSON.stringify(preset.rundown),
              audio_state: JSON.stringify(preset.audio_defaults),
              fallback_grace_s: preset.fallback_grace_s,
              profile: preset.profile_preference,
            }
          : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new AppError('SESSION_ACTIVE_EXISTS', 'session');
    throw e;
  }
}

export async function activeSession(db: Kysely<DB>) {
  return db
    .selectFrom('stream_sessions')
    .selectAll()
    .where('lifecycle', 'not in', ['ENDED', 'INTERRUPTED'])
    .executeTakeFirst();
}

export async function getSession(db: Kysely<DB>, id: string) {
  const s = await db
    .selectFrom('stream_sessions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!s) throw new AppError('NOT_FOUND', 'session');
  return s;
}

export async function listSources(db: Kysely<DB>, sessionId: string): Promise<SourceSummary[]> {
  const rows = await db
    .selectFrom('camera_sources')
    .select(['id', 'slot', 'label', 'status', 'verification_phrase', 'device_hint'])
    .where('session_id', '=', sessionId)
    .where('status', 'in', ['pending', 'admitted'])
    .orderBy('created_at')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    slot: r.slot,
    label: r.label,
    status: r.status as SourceSummary['status'],
    verificationPhrase: r.verification_phrase,
    deviceHint: r.device_hint,
  }));
}

export async function snapshot(db: Kysely<DB>, id: string): Promise<SessionSnapshot> {
  const s = await getSession(db, id);
  return {
    id: s.id,
    name: s.name,
    lifecycle: s.lifecycle as SessionSnapshot['lifecycle'],
    mode: s.mode as SessionSnapshot['mode'],
    generation: s.generation,
    sources: await listSources(db, id),
    lastSequence: Number(s.last_sequence),
  };
}

/** Append a durable event with a gap-free per-session sequence (row lock on the session). */
export async function appendEvent(
  db: Kysely<DB>,
  sessionId: string,
  kind: string,
  severity: SessionEvent['severity'],
  actor: string,
  data: Record<string, unknown> = {},
): Promise<SessionEvent> {
  return db.transaction().execute(async (trx) => {
    const s = await trx
      .updateTable('stream_sessions')
      .set({ last_sequence: sql`last_sequence + 1` })
      .where('id', '=', sessionId)
      .returning(['last_sequence', 'generation'])
      .executeTakeFirstOrThrow();
    const row = await trx
      .insertInto('session_events')
      .values({
        session_id: sessionId,
        sequence: s.last_sequence,
        generation: s.generation,
        kind,
        severity,
        actor,
        payload: JSON.stringify(data),
      })
      .returning(['id', 'occurred_at'])
      .executeTakeFirstOrThrow();
    return {
      schemaVersion: 1,
      eventId: row.id,
      sessionId,
      sessionGeneration: s.generation,
      sequence: Number(s.last_sequence),
      type: kind,
      severity,
      occurredAt: row.occurred_at.toISOString(),
      data,
    };
  });
}

export async function eventsSince(
  db: Kysely<DB>,
  sessionId: string,
  after: number,
  limit = 500,
): Promise<SessionEvent[]> {
  const rows = await db
    .selectFrom('session_events')
    .selectAll()
    .where('session_id', '=', sessionId)
    .where('sequence', '>', String(after))
    .orderBy('sequence')
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    schemaVersion: 1,
    eventId: r.id,
    sessionId,
    sessionGeneration: r.generation,
    sequence: Number(r.sequence),
    type: r.kind,
    severity: r.severity as SessionEvent['severity'],
    occurredAt: r.occurred_at.toISOString(),
    data: r.payload,
  }));
}

export async function setMode(
  db: Kysely<DB>,
  id: string,
  mode: 'rehearsal' | 'ingest_test',
): Promise<void> {
  await db.updateTable('stream_sessions').set({ mode }).where('id', '=', id).execute();
}

export async function endSession(db: Kysely<DB>, id: string, reason: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('stream_sessions')
      .set({ lifecycle: 'ENDED', ended_at: new Date(), end_reason: reason })
      .where('id', '=', id)
      .execute();
    await trx
      .updateTable('camera_sources')
      .set({ status: 'revoked', revoked_at: new Date() })
      .where('session_id', '=', id)
      .where('status', 'in', ['pending', 'admitted'])
      .execute();
    await trx
      .updateTable('camera_invitations')
      .set({ consumed_at: new Date() })
      .where('session_id', '=', id)
      .where('consumed_at', 'is', null)
      .execute();
    await trx
      .updateTable('ingest_tokens')
      .set({ revoked_at: new Date() })
      .where('session_id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
  });
}
