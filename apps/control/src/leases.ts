import { sql, type Kysely } from 'kysely';
import { DesiredState } from '@raelstream/contracts';
import type { DB } from './db.js';
import type { Principal } from './auth.js';
import { AppError } from './errors.js';

/** Active-studio lease (SPEC §17.3, B§8.4): 45 s TTL, renewed every 10 s by the holding tab. */
export const LEASE_TTL_MS = 45_000;

export interface LeaseInfo {
  mine: boolean;
  holderName: string | null;
  holderIsMe: boolean;
  generation: number;
}

/**
 * Acquire or renew. Succeeds when there is no lease, it expired, or this client already holds it.
 * Another live holder means this tab opens read-only (A33). Expiry blocks commands from a stale client
 * but never stops media by itself.
 */
export async function acquireLease(
  db: Kysely<DB>,
  sessionId: string,
  p: Principal,
  clientId: string,
  now = new Date(),
): Promise<LeaseInfo> {
  return db.transaction().execute(async (trx) => {
    const s = await trx
      .selectFrom('stream_sessions')
      .select(['generation', 'lifecycle'])
      .where('id', '=', sessionId)
      .forUpdate()
      .executeTakeFirst();
    if (!s) throw new AppError('NOT_FOUND', 'session');
    const l = await trx
      .selectFrom('studio_leases as l')
      .innerJoin('users as u', 'u.id', 'l.holder_user_id')
      .select(['l.holder_client_id', 'l.holder_user_id', 'l.expires_at', 'u.display_name'])
      .where('l.session_id', '=', sessionId)
      .executeTakeFirst();
    const free = !l || l.expires_at <= now || l.holder_client_id === clientId;
    if (!free)
      return {
        mine: false,
        holderName: l.display_name,
        holderIsMe: l.holder_user_id === p.userId,
        generation: s.generation,
      };
    const expires = new Date(now.getTime() + LEASE_TTL_MS);
    await trx
      .insertInto('studio_leases')
      .values({
        session_id: sessionId,
        holder_user_id: p.userId,
        holder_client_id: clientId,
        generation: s.generation,
        expires_at: expires,
      })
      .onConflict((oc) =>
        oc
          .column('session_id')
          .doUpdateSet({
            holder_user_id: p.userId,
            holder_client_id: clientId,
            generation: s.generation,
            expires_at: expires,
          }),
      )
      .execute();
    return { mine: true, holderName: p.name, holderIsMe: true, generation: s.generation };
  });
}

/** Guard for privileged session commands: only the current, unexpired holder with the current generation. */
export async function requireLease(
  db: Kysely<DB>,
  sessionId: string,
  clientId: string | undefined,
  now = new Date(),
): Promise<void> {
  if (!clientId) throw new AppError('LEASE_HELD', 'session');
  const l = await db
    .selectFrom('studio_leases as l')
    .innerJoin('stream_sessions as s', 's.id', 'l.session_id')
    .select(['l.holder_client_id', 'l.expires_at', 'l.generation', 's.generation as current'])
    .where('l.session_id', '=', sessionId)
    .executeTakeFirst();
  if (!l || l.holder_client_id !== clientId || l.expires_at <= now)
    throw new AppError('LEASE_HELD', 'session');
  if (l.generation !== l.current) throw new AppError('STALE_GENERATION', 'session');
}

/**
 * Take over the studio (A33, E37): bump the generation, move the lease, fence the old contribution
 * (its WHIP token is revoked and MediaMTX refuses the old generation). Owners may always take over;
 * operators only from their own other tab or an expired lease (SPEC §6.2).
 */
export async function takeover(
  db: Kysely<DB>,
  sessionId: string,
  p: Principal,
  clientId: string,
  now = new Date(),
): Promise<{ generation: number; previousClientId: string | null }> {
  return db.transaction().execute(async (trx) => {
    const s = await trx
      .selectFrom('stream_sessions')
      .select(['generation', 'desired_state', 'lifecycle'])
      .where('id', '=', sessionId)
      .forUpdate()
      .executeTakeFirst();
    if (!s || s.lifecycle === 'ENDED' || s.lifecycle === 'INTERRUPTED')
      throw new AppError('NOT_FOUND', 'session');
    const l = await trx
      .selectFrom('studio_leases')
      .selectAll()
      .where('session_id', '=', sessionId)
      .executeTakeFirst();
    const lapsed = !l || l.expires_at <= now;
    if (p.role !== 'owner' && !lapsed && l!.holder_user_id !== p.userId)
      throw new AppError('FORBIDDEN', 'session');
    const generation = s.generation + 1;
    const d = DesiredState.safeParse(s.desired_state);
    await trx
      .updateTable('stream_sessions')
      .set({
        generation,
        ...(d.success ? { desired_state: JSON.stringify({ ...d.data, generation }) } : {}),
      })
      .where('id', '=', sessionId)
      .execute();
    await trx
      .insertInto('studio_leases')
      .values({
        session_id: sessionId,
        holder_user_id: p.userId,
        holder_client_id: clientId,
        generation,
        expires_at: new Date(now.getTime() + LEASE_TTL_MS),
      })
      .onConflict((oc) =>
        oc
          .column('session_id')
          .doUpdateSet({
            holder_user_id: p.userId,
            holder_client_id: clientId,
            generation,
            expires_at: new Date(now.getTime() + LEASE_TTL_MS),
          }),
      )
      .execute();
    await trx
      .updateTable('ingest_tokens')
      .set({ revoked_at: now })
      .where('session_id', '=', sessionId)
      .where('generation', '<', generation)
      .where('revoked_at', 'is', null)
      .execute();
    await sql`select pg_notify('desired_changed', ${sessionId})`.execute(trx);
    return { generation, previousClientId: l?.holder_client_id ?? null };
  });
}
