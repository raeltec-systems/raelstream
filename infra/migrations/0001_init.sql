-- Raelstream 0001: WP0/WP1 foundation subset of SPEC §5.
-- PostgreSQL 18: uuidv7() is built in.

create extension if not exists citext;

create type session_lifecycle as enum
  ('DRAFT','PREPARING','READY','STARTING','SENDING','PARTIAL','RECOVERING','STOPPING','ENDED','INTERRUPTED');

create table stream_sessions (
  id uuid primary key default uuidv7(),
  name text not null,
  lifecycle session_lifecycle not null default 'PREPARING',
  generation int not null default 1,
  mode text not null default 'rehearsal' check (mode in ('rehearsal','ingest_test','live')),
  profile text check (profile in ('full_hd','reliable_hd')),
  operator_name text not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  last_sequence bigint not null default 0
);
-- max_concurrent_sessions: 1 (B Appendix B), enforced in the database.
create unique index one_active_session on stream_sessions ((true))
  where lifecycle not in ('ENDED','INTERRUPTED');

create table camera_invitations (
  id uuid primary key default uuidv7(),
  session_id uuid not null references stream_sessions on delete cascade,
  token_hash bytea unique not null,
  slot int not null default 1,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table camera_sources (
  id uuid primary key default uuidv7(),
  session_id uuid not null references stream_sessions on delete cascade,
  invitation_id uuid references camera_invitations,
  slot int not null,
  label text not null,
  verification_phrase text not null,
  device_hint text not null default '',
  device_fingerprint bytea not null,
  status text not null check (status in ('pending','admitted','rejected','revoked')),
  credential_hash bytea unique not null,
  credential_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  admitted_at timestamptz,
  revoked_at timestamptz
);
create unique index one_source_per_slot on camera_sources (session_id, slot)
  where status in ('pending','admitted');

create table ingest_tokens (
  token_hash bytea primary key,
  session_id uuid not null references stream_sessions on delete cascade,
  generation int not null,
  path text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table session_events (
  id uuid primary key default uuidv7(),
  session_id uuid not null references stream_sessions on delete cascade,
  sequence bigint not null,
  generation int not null,
  kind text not null,
  severity text not null check (severity in ('info','warn','critical')),
  actor text not null,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}',
  unique (session_id, sequence)
);

create table venue_profile (
  id int primary key default 1 check (id = 1),
  production_ssid text not null default '',
  wan_block_test_passed_at timestamptz
);
insert into venue_profile (id) values (1);
