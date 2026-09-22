import { Kysely, PostgresDialect, type Generated, type ColumnType } from 'kysely';
import pg from 'pg';

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;

export interface DB {
  stream_sessions: {
    id: Generated<string>;
    name: string;
    lifecycle: Generated<string>;
    generation: Generated<number>;
    mode: Generated<string>;
    profile: string | null;
    operator_name: string;
    created_at: Generated<Date>;
    ended_at: TsNull;
    end_reason: string | null;
    last_sequence: ColumnType<string, string | number | undefined, string | number>;
  };
  camera_invitations: {
    id: Generated<string>;
    session_id: string;
    token_hash: Buffer;
    slot: Generated<number>;
    expires_at: Ts;
    consumed_at: TsNull;
    created_at: Generated<Date>;
  };
  camera_sources: {
    id: Generated<string>;
    session_id: string;
    invitation_id: string | null;
    slot: number;
    label: string;
    verification_phrase: string;
    device_hint: Generated<string>;
    device_fingerprint: Buffer;
    status: string;
    credential_hash: Buffer;
    credential_expires_at: Ts;
    created_at: Generated<Date>;
    admitted_at: TsNull;
    revoked_at: TsNull;
  };
  ingest_tokens: {
    token_hash: Buffer;
    session_id: string;
    generation: number;
    path: string;
    expires_at: Ts;
    revoked_at: TsNull;
  };
  session_events: {
    id: Generated<string>;
    session_id: string;
    sequence: ColumnType<string, string | number, string | number>;
    generation: number;
    kind: string;
    severity: string;
    actor: string;
    occurred_at: Generated<Date>;
    payload: ColumnType<Record<string, unknown>, string, string>;
  };
  venue_profile: {
    id: Generated<number>;
    production_ssid: string;
    wan_block_test_passed_at: TsNull;
  };
}

export function createDb(databaseUrl: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl, max: 10 }) }),
  });
}
