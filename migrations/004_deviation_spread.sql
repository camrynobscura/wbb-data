-- 004 — spread + percentile ladders for the deviation bars.
--
-- The Season Breakdown bars are moving from "relative % above/below the baseline" (which
-- saturates for elite players and explodes on small-denominator stats like blocks) to
-- "distance from the baseline measured in league-steps" — a z-score. That needs two things
-- per season that the plain averages don't carry:
--
--   * stddev_* — the population spread of each per-game COUNTING stat across that season's
--     qualified players. It's the "one step" the bar is measured in. Only the five counting
--     stats get it (pts/reb/ast/stl/blk); the shooting %s keep their relative-% bar, so they
--     need no spread. Population stddev (stddev_pop), not sample — we hold the whole qualified
--     population that season, we're not inferring a super-population, and it matches the
--     numbers the design was validated against.
--
--   * pctiles — a value-at-percentile ladder per counting stat (deciles: 11 values at the
--     0,10,…,100th percentiles), so the frontend can turn a player's value into a percentile
--     for the hover tooltip. Distribution-free, so it stays honest on the skewed stats where a
--     mean+stddev normal approximation would lie.
--
-- Both live on league_seasons AND position_seasons — the position bars use the POSITION's own
-- spread/percentiles (the point of comparing to your position), while the "own" baseline bars
-- borrow the league spread (a player has no crowd of their own). Nullable: existing rows read
-- NULL until the next computeLeague/computePositions run, and the frontend falls back to the
-- old relative-% bar when the spread is absent (so a frontend-first deploy degrades, not
-- breaks). See src/db/computeLeague.ts, src/db/computePositions.ts, and wnba-arc deviation.ts.

ALTER TABLE league_seasons
  ADD COLUMN IF NOT EXISTS stddev_points   numeric,
  ADD COLUMN IF NOT EXISTS stddev_rebounds numeric,
  ADD COLUMN IF NOT EXISTS stddev_assists  numeric,
  ADD COLUMN IF NOT EXISTS stddev_steals   numeric,
  ADD COLUMN IF NOT EXISTS stddev_blocks   numeric,
  ADD COLUMN IF NOT EXISTS pctiles         jsonb;

ALTER TABLE position_seasons
  ADD COLUMN IF NOT EXISTS stddev_points   numeric,
  ADD COLUMN IF NOT EXISTS stddev_rebounds numeric,
  ADD COLUMN IF NOT EXISTS stddev_assists  numeric,
  ADD COLUMN IF NOT EXISTS stddev_steals   numeric,
  ADD COLUMN IF NOT EXISTS stddev_blocks   numeric,
  ADD COLUMN IF NOT EXISTS pctiles         jsonb;
