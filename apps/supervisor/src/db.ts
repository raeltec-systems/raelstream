import { Kysely, PostgresDialect, type ColumnType } from 'kysely';
import pg from 'pg';
import type { DesiredState, ObservedState } from '@raelstream/contracts';

type Json<T> = ColumnType<T, string, string>;

/** Only the columns the supervisor reads or writes. */
export interface SupervisorDB {
  stream_sessions: {
    id: string;
    name: string;
    lifecycle: string;
    generation: number;
    desired_state: Json<DesiredState | Record<string, never>>;
    observed_state: Json<ObservedState | Record<string, never>>;
    ended_at: ColumnType<Date | null, Date | null, Date | null>;
    end_reason: string | null;
  };
  destinations: {
    id: string;
    platform: string;
    label: string;
    server_url: string;
    key_enc: Buffer | null;
    key_mode: string;
    enabled: boolean;
  };
  session_destinations: {
    session_id: string;
    destination_id: string;
    session_key_enc: Buffer | null;
  };
  ingest_tokens: {
    session_id: string;
    revoked_at: ColumnType<Date | null, Date | null, Date | null>;
  };
}

export function createDb(url: string): { db: Kysely<SupervisorDB>; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  return { db: new Kysely<SupervisorDB>({ dialect: new PostgresDialect({ pool }) }), pool };
}
