-- A phone whose socket was down when it was admitted never received its contributor credential.
-- Keep the pending credential's hash for a short window so it can be exchanged, once, for a fresh one.
alter table camera_sources
  add column pending_credential_hash bytea,
  add column pending_valid_until timestamptz;
