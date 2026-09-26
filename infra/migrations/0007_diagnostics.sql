-- M8: studio statistics, uploaded as 10-second aggregates for the service report (SPEC §19).
create table diagnostic_summaries (
  session_id uuid not null references stream_sessions on delete cascade,
  window_start timestamptz not null,
  window_s int not null check (window_s between 1 and 60),
  metrics jsonb not null,
  primary key (session_id, window_start)
);
