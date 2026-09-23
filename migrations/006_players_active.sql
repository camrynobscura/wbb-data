-- 006 — players.active: ESPN's own "still playing" flag.
--
-- The full-history build brings in ~900 retired players. ESPN marks them `active: false`
-- (`status.type = "inactive"`), and a retired bio's team reference is unreliable — Deanna
-- Nolan's points at a franchise she never played for — so ingest resolves current_team_id
-- only for an active player; a retired player's stays null (she has no current team). The
-- flag also lets the API say who is retired without inferring it from the years. Defaults to
-- true so existing rows keep today's behaviour until their next ingest writes the real value.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
