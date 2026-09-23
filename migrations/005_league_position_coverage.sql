-- 005 — position coverage on league_seasons: the gate for "compare to same position".
--
-- ESPN has no position for most players from before ~2012: its bio and per-season rows carry
-- positions/0 "Not Available" for them (5% of 1997's players have a real position, 87% of
-- 2011's, 100% from 2012 on — measured 2026-09-23). Once the database holds every player for
-- every season, a per-position average or rank for one of those years would be computed over
-- whichever players happen to be placed — biased, and silently so, because the thin-bucket
-- gate (>= 8 qualified players) can't see what's missing.
--
-- So computeLeague records, per season, how many player-seasons qualified for the league
-- averages and how many of those belong to a player with a known position. A season is
-- position-complete only when the two are equal, and ONLY then does computePositions write
-- its buckets and /players/:id report a position rank (RANK_SQL in src/api/queries.ts) — the
-- same rule in one place, read by both. Two facts rather than a boolean, so the shortfall per
-- year (qualified − placed) can be read directly when deciding whether a gap is worth filling.
--
-- Nullable: rows written before this migration read NULL, which the consumers treat as "not
-- complete" until the next computeLeague run over every year. League averages and league ranks
-- are never gated — they are complete for every year.

ALTER TABLE league_seasons
  ADD COLUMN IF NOT EXISTS qualified_players       integer,
  ADD COLUMN IF NOT EXISTS qualified_with_position integer;
