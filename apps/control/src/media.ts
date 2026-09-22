import { sql, type Kysely } from 'kysely';
import { DesiredState, type DestinationSummary, type StartRequest } from '@raelstream/contracts';
import type { DB } from './db.js';
import { AppError } from './errors.js';
import { getSession } from './sessions.js';

async function notifyDesired(db: Kysely<DB>, sessionId: string): Promise<void> {
  await sql`select pg_notify('desired_changed', ${sessionId})`.execute(db);
}

export async function listDestinations(db: Kysely<DB>): Promise<DestinationSummary[]> {
  const rows = await db
    .selectFrom('destinations')
    .selectAll()
    .where('archived_at', 'is', null)
    .where('enabled', '=', true)
    .orderBy('created_at')
    .execute();
  // Keys are never returned; only the last four characters (B§16.2).
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform as DestinationSummary['platform'],
    label: r.label,
    keyLast4: r.key_last4,
    keyMode: r.key_mode as DestinationSummary['keyMode'],
    autoPublishesOnIngest:
      r.auto_publishes_on_ingest as DestinationSummary['autoPublishesOnIngest'],
    watchUrl: r.watch_url,
  }));
}

function currentDesired(raw: unknown): DesiredState | null {
  const r = DesiredState.safeParse(raw);
  return r.success ? r.data : null;
}

/** Idempotent command wrapper (B§19.2): a repeated key returns the first result. */
export async function idempotent<T extends Record<string, unknown>>(
  db: Kysely<DB>,
  key: string | undefined,
  sessionId: string,
  command: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (key) {
    const prev = await db
      .selectFrom('command_log')
      .select('result')
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
    if (prev) return prev.result as T;
  }
  const result = await fn();
  if (key) {
    await db
      .insertInto('command_log')
      .values({
        idempotency_key: key,
        session_id: sessionId,
        command,
        result: JSON.stringify(result),
      })
      .onConflict((oc) => oc.column('idempotency_key').doNothing())
      .execute();
  }
  return result;
}

/**
 * Start the media node for a session (SPEC §12.1). `ingest_test` runs the normaliser only (no
 * destinations); `live` adds one publisher per selected destination. A running private test can be
 * upgraded to live without reconnecting, as long as the profile is unchanged (B§14.3).
 */
export async function startMedia(
  db: Kysely<DB>,
  sessionId: string,
  req: StartRequest,
): Promise<{ desired: DesiredState }> {
  const s = await getSession(db, sessionId);
  if (s.lifecycle === 'ENDED' || s.lifecycle === 'INTERRUPTED' || s.lifecycle === 'STOPPING')
    throw new AppError('SESSION_ACTIVE_EXISTS', 'session');
  const existing = currentDesired(s.desired_state);
  const running = existing && existing.normaliser === 'running' && !existing.stopRequestedAt;
  if (running && existing.mode === req.mode) return { desired: existing }; // repeated Start (A32)
  if (running && existing.profile !== req.profile) throw new AppError('VALIDATION', 'session');

  const publishers: DesiredState['publishers'] = {};
  if (req.mode === 'live') {
    if (req.destinationIds.length === 0) throw new AppError('DEST_NOT_CONFIGURED', 'destination');
    const dests = await db
      .selectFrom('destinations')
      .selectAll()
      .where('id', 'in', req.destinationIds)
      .where('archived_at', 'is', null)
      .execute();
    if (dests.length !== req.destinationIds.length || dests.some((d) => !d.enabled))
      throw new AppError('DEST_NOT_CONFIGURED', 'destination');
    // Block start while any selected destination lacks a key (B§16.4).
    if (dests.some((d) => !d.key_enc)) throw new AppError('DEST_KEY_MISSING', 'destination');
    for (const id of req.destinationIds) publishers[id] = { state: 'running', retryNonce: 0 };
  }
  const desired: DesiredState = {
    generation: s.generation,
    mode: req.mode,
    profile: req.profile,
    normaliser: 'running',
    publishers,
    fallbackGraceS: s.fallback_grace_s,
    stopRequestedAt: null,
    endOnStop: req.mode === 'live',
  };
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('stream_sessions')
      .set({
        desired_state: JSON.stringify(desired),
        mode: req.mode,
        profile: req.profile,
        ...(req.mode === 'live' ? { lifecycle: 'STARTING', started_at: new Date() } : {}),
      })
      .where('id', '=', sessionId)
      .execute();
    if (req.mode === 'live') {
      await trx
        .insertInto('session_destinations')
        .values(req.destinationIds.map((d) => ({ session_id: sessionId, destination_id: d })))
        .onConflict((oc) => oc.columns(['session_id', 'destination_id']).doNothing())
        .execute();
    }
  });
  await notifyDesired(db, sessionId);
  return { desired };
}

/** Stop sending: idempotent, and takes precedence over reconnect attempts (A34). */
export async function stopMedia(db: Kysely<DB>, sessionId: string): Promise<{ stopping: boolean }> {
  const s = await getSession(db, sessionId);
  const d = currentDesired(s.desired_state);
  if (!d || d.normaliser !== 'running') return { stopping: false };
  if (d.stopRequestedAt) return { stopping: true };
  const next: DesiredState = { ...d, stopRequestedAt: new Date().toISOString() };
  await db
    .updateTable('stream_sessions')
    .set({
      desired_state: JSON.stringify(next),
      ...(d.mode === 'live' ? { lifecycle: 'STOPPING' } : {}),
    })
    .where('id', '=', sessionId)
    .execute();
  await notifyDesired(db, sessionId);
  return { stopping: true };
}

/** Retry one destination only; the other publisher is untouched (A28). */
export async function retryDestination(
  db: Kysely<DB>,
  sessionId: string,
  destinationId: string,
): Promise<void> {
  const s = await getSession(db, sessionId);
  const d = currentDesired(s.desired_state);
  const p = d?.publishers[destinationId];
  if (!d || !p || d.stopRequestedAt) throw new AppError('NOT_SENDING', 'destination');
  const next: DesiredState = {
    ...d,
    publishers: {
      ...d.publishers,
      [destinationId]: { state: 'running', retryNonce: p.retryNonce + 1 },
    },
  };
  await db
    .updateTable('stream_sessions')
    .set({ desired_state: JSON.stringify(next) })
    .where('id', '=', sessionId)
    .execute();
  await notifyDesired(db, sessionId);
}
