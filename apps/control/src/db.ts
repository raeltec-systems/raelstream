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
    desired_state: ColumnType<Record<string, unknown>, string | undefined, string>;
    observed_state: ColumnType<Record<string, unknown>, string | undefined, string>;
    fallback_grace_s: Generated<number>;
    started_at: TsNull;
    preset_id: string | null;
    created_by: string | null;
    rundown: ColumnType<unknown[], string | undefined, string>;
    audio_state: ColumnType<Record<string, unknown>, string | undefined, string>;
    uplink_test: ColumnType<
      Record<string, unknown> | null,
      string | null | undefined,
      string | null
    >;
  };
  destinations: {
    id: Generated<string>;
    platform: string;
    label: string;
    server_url: string;
    key_enc: Buffer | null;
    key_last4: string | null;
    key_updated_at: TsNull;
    key_mode: string;
    auto_publishes_on_ingest: Generated<string>;
    watch_url: string | null;
    event_reference: Generated<string>;
    enabled: Generated<boolean>;
    created_at: Generated<Date>;
    archived_at: TsNull;
  };
  session_destinations: {
    session_id: string;
    destination_id: string;
    selected_at: Generated<Date>;
    session_key_enc: Buffer | null;
    session_key_last4: string | null;
    live_confirmation: ColumnType<
      { source: 'operator'; by: string; at: string } | null,
      string | null,
      string | null
    >;
  };
  command_log: {
    idempotency_key: string;
    session_id: string | null;
    command: string;
    result: ColumnType<Record<string, unknown>, string, string>;
    created_at: Generated<Date>;
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
    pending_credential_hash: Buffer | null;
    pending_valid_until: TsNull;
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
  users: {
    id: Generated<string>;
    email: string;
    display_name: string;
    role: 'owner' | 'operator';
    password_hash: string;
    totp_secret_enc: Buffer | null;
    totp_confirmed_at: TsNull;
    totp_last_step: ColumnType<string, string | number | undefined, string | number>;
    recovery_codes_hash: ColumnType<string[], string[] | undefined, string[]>;
    failed_logins: Generated<number>;
    locked_until: TsNull;
    disabled_at: TsNull;
    created_at: Generated<Date>;
  };
  auth_sessions: {
    id_hash: Buffer;
    user_id: string;
    csrf: string;
    created_at: Generated<Date>;
    last_seen_at: Ts;
    expires_at: Ts;
    revoked_at: TsNull;
    user_agent: string | null;
  };
  mfa_challenges: {
    id_hash: Buffer;
    user_id: string;
    purpose: 'login' | 'enrol';
    expires_at: Ts;
    used_at: TsNull;
  };
  operator_invites: {
    id: Generated<string>;
    token_hash: Buffer;
    created_by: string;
    expires_at: Ts;
    consumed_at: TsNull;
    consumed_by: string | null;
    created_at: Generated<Date>;
  };
  presets: {
    id: Generated<string>;
    name: string;
    profile_preference: Generated<string>;
    rundown: ColumnType<unknown[], string | undefined, string>;
    audio_defaults: ColumnType<Record<string, unknown>, string | undefined, string>;
    destination_ids: ColumnType<string[], string[] | undefined, string[]>;
    fallback_grace_s: Generated<number>;
    created_by: string | null;
    updated_at: Ts;
    archived_at: TsNull;
  };
  studio_leases: {
    session_id: string;
    holder_user_id: string;
    holder_client_id: string;
    generation: number;
    expires_at: Ts;
  };
  venue_profile: {
    id: Generated<number>;
    production_ssid: string;
    wan_block_test_passed_at: TsNull;
    theme: Generated<Record<string, unknown>>;
  };
  assets: {
    id: Generated<string>;
    sha256: Buffer;
    mime: 'image/png' | 'image/jpeg';
    width: number;
    height: number;
    bytes: number;
    data: Buffer;
    created_by: string | null;
    created_at: Generated<Ts>;
  };
  diagnostic_summaries: {
    session_id: string;
    window_start: Ts;
    window_s: number;
    metrics: ColumnType<Record<string, unknown>, string, string>;
  };
  sync_calibrations: {
    id: Generated<string>;
    session_id: string | null;
    source_fingerprint: string;
    audio_mapping: string;
    audio_device_label: string;
    profile: string;
    app_version: string;
    offset_ms: number;
    measured_offset_ms: number | null;
    result: 'ok' | 'audio_late';
    method: string;
    measured_at: Generated<Ts>;
    measured_by: string | null;
  };
}

export function createDb(databaseUrl: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl, max: 10 }) }),
  });
}
