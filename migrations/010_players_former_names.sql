-- 010 — players.former_names: the names a player had before ESPN changed them.
--
-- A player is identified by ESPN's id, and the daily refresh overwrites the bio in place, so a
-- name change (a marriage, a corrected spelling) used to leave no trace: the old name matched
-- nobody in search, and an address built from it stopped resolving. Ingest now keeps the outgoing
-- name here when the name changes (src/db/formerNames.ts), oldest first, and GET /players sends
-- the list so a client can still find the player by it.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS former_names text[] NOT NULL DEFAULT '{}';
