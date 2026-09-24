-- M6: uploaded images (SPEC §10.6), the church theme (§10.5) and lip-sync calibrations (§11.4).
-- Images are small after re-encoding, so they live in the database and are covered by its backups.
create table assets (
  id uuid primary key default uuidv7(),
  sha256 bytea not null unique,
  mime text not null check (mime in ('image/png', 'image/jpeg')),
  width int not null check (width between 1 and 4096),
  height int not null check (height between 1 and 4096),
  bytes int not null,
  data bytea not null,
  created_by uuid references users,
  created_at timestamptz not null default now()
);

alter table venue_profile add column theme jsonb not null default '{}';

create table sync_calibrations (
  id uuid primary key default uuidv7(),
  session_id uuid references stream_sessions on delete set null,
  source_fingerprint text not null,
  audio_mapping text not null,
  audio_device_label text not null,
  profile text not null,
  app_version text not null,
  offset_ms int not null check (offset_ms between 0 and 2000),
  measured_offset_ms int,
  result text not null check (result in ('ok', 'audio_late')),
  method text not null,
  measured_at timestamptz not null default now(),
  measured_by uuid references users
);
