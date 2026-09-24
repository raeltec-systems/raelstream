-- M7: destination management, the Facebook per-event key, operator live confirmation, uplink test.
alter table destinations add column event_reference text not null default '';

alter table session_destinations
  add column session_key_enc bytea,        -- per-event key (FB, I-13), sealed for the supervisor
  add column session_key_last4 text,       -- kept after the wipe for "looks like last week's key"
  add column live_confirmation jsonb;      -- {source:'operator', by, at} (SPEC §13.4)

-- Per-event keys are wiped as soon as a service ends, whichever process ends it (SPEC §13.3).
create function rs_wipe_session_keys() returns trigger language plpgsql as $$
begin
  if new.lifecycle in ('ENDED', 'INTERRUPTED') and old.lifecycle is distinct from new.lifecycle then
    update session_destinations set session_key_enc = null where session_id = new.id;
  end if;
  return new;
end $$;
create trigger rs_wipe_session_keys after update of lifecycle on stream_sessions
  for each row execute function rs_wipe_session_keys();

alter table stream_sessions add column uplink_test jsonb;
