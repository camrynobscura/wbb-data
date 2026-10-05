-- 003 — position_seasons: per-season, per-position league averages — the data behind the
-- "compare to same position" baseline. Same qualified-player filter and rate-from-totals
-- math as league_seasons, but GROUPed by the player's position (G/F/C) and gated by a
-- minimum sample of 8 qualified players. Thin position-years (mostly pre-2015, where our
-- current-players universe holds only a handful of that-era veterans) produce NO row, so
-- the app reads a missing row as "no same-position sample that season" rather than showing
-- a misleading average built from two or three players. Threshold measured against the real
-- qualified-per-position histogram on 2026-08-24 (everything from 2015 on clears 8).
-- See src/db/computePositions.ts and wbb-arc/src/lib/deviation.ts.

CREATE TABLE IF NOT EXISTS position_seasons (
    season_year smallint NOT NULL,
    position text NOT NULL,                -- G / F / C (players.position)
    qualified_players smallint NOT NULL,   -- how many players fed this row (>= 8)
    avg_points numeric,
    avg_rebounds numeric,
    avg_assists numeric,
    avg_steals numeric,
    avg_blocks numeric,
    avg_turnovers numeric,
    avg_fg_pct numeric,
    avg_fg3_pct numeric,
    avg_ts_pct numeric,
    avg_efg_pct numeric,
    avg_tov_pct numeric,
    avg_fg3a_rate numeric,
    avg_ft_rate numeric,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (season_year, position)
);

-- Same auto-bump trigger the other tables use (set_updated_at, from migration 002).
DROP TRIGGER IF EXISTS position_seasons_set_updated_at ON position_seasons;
CREATE TRIGGER position_seasons_set_updated_at BEFORE UPDATE ON position_seasons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
