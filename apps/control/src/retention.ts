import type { Kysely } from 'kysely';
import type { DB } from './db.js';

/** Retention defaults (SPEC §5, B§20.3). Runs at start-up and daily. Returns rows removed per table. */
export async function runRetention(
  db: Kysely<DB>,
  now = new Date(),
): Promise<Record<string, number>> {
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const n = (r: { numDeletedRows: bigint }[]) => Number(r[0]?.numDeletedRows ?? 0n);
  return {
    session_events: n(
      await db.deleteFrom('session_events').where('occurred_at', '<', ago(90)).execute(),
    ),
    camera_invitations: n(
      await db
        .deleteFrom('camera_invitations')
        .where('expires_at', '<', ago(7))
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('camera_sources')
                .select('id')
                .whereRef('camera_sources.invitation_id', '=', 'camera_invitations.id'),
            ),
          ),
        )
        .execute(),
    ),
    auth_sessions: n(
      await db.deleteFrom('auth_sessions').where('expires_at', '<', ago(30)).execute(),
    ),
    mfa_challenges: n(
      await db.deleteFrom('mfa_challenges').where('expires_at', '<', ago(1)).execute(),
    ),
    operator_invites: n(
      await db
        .deleteFrom('operator_invites')
        .where('expires_at', '<', ago(7))
        .where('consumed_by', 'is', null)
        .execute(),
    ),
    command_log: n(await db.deleteFrom('command_log').where('created_at', '<', ago(30)).execute()),
    ingest_tokens: n(
      await db.deleteFrom('ingest_tokens').where('expires_at', '<', ago(7)).execute(),
    ),
  };
}

export function scheduleRetention(
  db: Kysely<DB>,
  log: (m: string, d?: object) => void,
): () => void {
  const run = () =>
    void runRetention(db)
      .then((r) => log('retention', r))
      .catch((e) => log('retention failed', { err: (e as Error).message }));
  run();
  const t = setInterval(run, 86_400_000);
  t.unref();
  return () => clearInterval(t);
}
