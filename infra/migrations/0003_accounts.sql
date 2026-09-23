-- Raelstream 0003: accounts, login sessions, invites, presets, studio leases (SPEC §5, §6, WP1).

create type user_role as enum ('owner','operator');

create table users (
  id uuid primary key default uuidv7(),
  email citext unique not null,
  display_name text not null,
  role user_role not null,
  password_hash text not null,
  -- AES-256-GCM with the control key (RS_TOTP_KEY); never stored in plaintext
  totp_secret_enc bytea,
  totp_confirmed_at timestamptz,
  -- last accepted TOTP time step: a code can be used once (replay protection)
  totp_last_step bigint not null default 0,
  recovery_codes_hash text[] not null default '{}',
  failed_logins int not null default 0,
  locked_until timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create table auth_sessions (
  id_hash bytea primary key,
  user_id uuid not null references users on delete cascade,
  csrf text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text
);
create index auth_sessions_user on auth_sessions (user_id);

-- Password verified, second factor pending (short-lived, single use)
create table mfa_challenges (
  id_hash bytea primary key,
  user_id uuid not null references users on delete cascade,
  purpose text not null check (purpose in ('login','enrol')),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table operator_invites (
  id uuid primary key default uuidv7(),
  token_hash bytea unique not null,
  created_by uuid not null references users,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references users,
  created_at timestamptz not null default now()
);

create table presets (
  id uuid primary key default uuidv7(),
  name text not null,
  profile_preference text not null default 'reliable_hd' check (profile_preference in ('reliable_hd','full_hd')),
  rundown jsonb not null default '[]',
  audio_defaults jsonb not null default '{}',
  destination_ids uuid[] not null default '{}',
  fallback_grace_s int not null default 120 check (fallback_grace_s between 60 and 600),
  created_by uuid references users,
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table stream_sessions
  add column preset_id uuid references presets,
  add column created_by uuid references users,
  add column rundown jsonb not null default '[]',
  add column audio_state jsonb not null default '{}';

create table studio_leases (
  session_id uuid primary key references stream_sessions on delete cascade,
  holder_user_id uuid not null references users,
  holder_client_id uuid not null,
  generation int not null,
  expires_at timestamptz not null
);
