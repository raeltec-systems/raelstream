-- Raelstream 0002: media-node desired/observed state and destinations (SPEC §5, §12.1, §13).

alter table stream_sessions
  add column desired_state jsonb not null default '{}',
  add column observed_state jsonb not null default '{}',
  add column fallback_grace_s int not null default 120 check (fallback_grace_s between 60 and 600),
  add column started_at timestamptz;

create table destinations (
  id uuid primary key default uuidv7(),
  platform text not null check (platform in ('facebook','youtube')),
  label text not null,
  server_url text not null,
  -- libsodium sealed box: only the supervisor can open it (SPEC §14.2)
  key_enc bytea,
  key_last4 text,
  key_updated_at timestamptz,
  key_mode text not null check (key_mode in ('persistent','per_event')),
  auto_publishes_on_ingest text not null default 'unknown' check (auto_publishes_on_ingest in ('yes','no','unknown')),
  watch_url text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table session_destinations (
  session_id uuid not null references stream_sessions on delete cascade,
  destination_id uuid not null references destinations,
  selected_at timestamptz not null default now(),
  primary key (session_id, destination_id)
);

create table command_log (
  idempotency_key uuid primary key,
  session_id uuid references stream_sessions on delete cascade,
  command text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
