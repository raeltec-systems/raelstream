import pg from 'pg';
import type { Kysely } from 'kysely';
import { ObservedState, type SessionLifecycle } from '@raelstream/contracts';
import type { DB } from './db.js';
import type { Hub } from './hub.js';

export async function readObserved(
  db: Kysely<DB>,
  sessionId: string,
): Promise<{ lifecycle: SessionLifecycle; observed: ObservedState | null } | null> {
  const row = await db
    .selectFrom('stream_sessions')
    .select(['lifecycle', 'observed_state'])
    .where('id', '=', sessionId)
    .executeTakeFirst();
  if (!row) return null;
  const o = ObservedState.safeParse(row.observed_state);
  return { lifecycle: row.lifecycle as SessionLifecycle, observed: o.success ? o.data : null };
}

/**
 * Relay supervisor state to studios (SPEC §4.2): the supervisor writes observed_state and NOTIFYs;
 * control reads it and pushes it over the session socket. Throttled per session to 4 Hz.
 */
export async function startObservedRelay(
  databaseUrl: string,
  db: Kysely<DB>,
  hub: Hub,
): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  client.on('notification', (n) => {
    const id = n.payload;
    if (!id || pending.has(id)) return;
    pending.set(
      id,
      setTimeout(async () => {
        pending.delete(id);
        const r = await readObserved(db, id).catch(() => null);
        if (r) hub.broadcastObserved(id, r.lifecycle, r.observed);
      }, 250),
    );
  });
  await client.query('listen observed_changed');
  return async () => {
    for (const t of pending.values()) clearTimeout(t);
    await client.end();
  };
}
