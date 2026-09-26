-- A different phone may take over a camera whose phone has gone (dead battery, browser storage wiped).
-- It waits as a pending "replacement" beside the admitted camera it replaces; letting it in revokes the
-- old camera and makes it the slot's camera, in one transaction.
alter table camera_sources add column replaces_source_id uuid references camera_sources(id);

drop index one_source_per_slot;
create unique index one_source_per_slot on camera_sources (session_id, slot)
  where status in ('pending','admitted') and replaces_source_id is null;
-- At most one phone waits to replace a camera.
create unique index one_replacement_per_slot on camera_sources (session_id, slot)
  where status = 'pending' and replaces_source_id is not null;
