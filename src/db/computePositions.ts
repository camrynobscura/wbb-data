import type { Pool } from 'pg'
import { pctlLadder } from './spread'

// Minimum qualified players for a (season, position) to get a stored average. Below this the
// row is omitted → the app shows "no same-position sample that season" instead of a noisy
// two- or three-player mean. Measured against the real qualified-per-position histogram
// (2026-08-24): everything from 2015 on clears 8, only thin pre-2015 buckets fall below.
// Keep in sync with the frontend's missing-baseline copy (wnba-arc deviation.ts / captions).
const MIN_QUALIFIED = 8

// The "played enough to count" bar that picks which player-seasons feed the averages. MUST
// stay equal to computeLeague.ts's SMALL_SAMPLE_FRACTION (and the frontend's) — one concept,
// three places: it decides the greyed-out seasons in the UI AND who qualifies for both the
// league and the position averages.
const SMALL_SAMPLE_FRACTION = 0.25

// $1 = optional single season year to (re)compute; NULL does every year.
const DELETE_SQL = `DELETE FROM position_seasons WHERE ($1::int IS NULL OR season_year = $1::int)`

// $1 = optional single season year (NULL = all). $2 = small-sample fraction. $3 = min sample.
// scheduled_games is read from league_seasons (already computed this run), so this never
// re-fetches a team schedule from ESPN. The math mirrors computeLeague.ts exactly (rate stats
// from summed totals, not a mean of per-player rates) so a position average is directly
// comparable to the league average on the same stat.
const INSERT_SQL = `
INSERT INTO position_seasons (
  season_year, position, qualified_players,
  avg_points, avg_rebounds, avg_assists, avg_steals, avg_blocks, avg_turnovers,
  avg_fg_pct, avg_fg3_pct,
  avg_ts_pct, avg_efg_pct, avg_tov_pct, avg_fg3a_rate, avg_ft_rate,
  stddev_points, stddev_rebounds, stddev_assists, stddev_steals, stddev_blocks,
  pctiles, updated_at
)
SELECT
  ps.season_year,
  p.position,
  COUNT(*),
  AVG(ps.points::numeric    / ps.games_played),
  AVG(ps.rebounds::numeric  / ps.games_played),
  AVG(ps.assists::numeric   / ps.games_played),
  AVG(ps.steals::numeric    / ps.games_played),
  AVG(ps.blocks::numeric    / ps.games_played),
  AVG(ps.turnovers::numeric / ps.games_played),
  SUM(ps.fg_made)::numeric  / NULLIF(SUM(ps.fg_att), 0),
  SUM(ps.fg3_made)::numeric / NULLIF(SUM(ps.fg3_att), 0),
  SUM(ps.points)::numeric / NULLIF(2 * (SUM(ps.fg_att) + 0.44 * SUM(ps.ft_att)), 0),
  (SUM(ps.fg_made) + 0.5 * SUM(ps.fg3_made))::numeric / NULLIF(SUM(ps.fg_att), 0),
  SUM(ps.turnovers)::numeric / NULLIF(SUM(ps.fg_att) + 0.44 * SUM(ps.ft_att) + SUM(ps.turnovers), 0),
  SUM(ps.fg3_att)::numeric / NULLIF(SUM(ps.fg_att), 0),
  SUM(ps.ft_att)::numeric / NULLIF(SUM(ps.fg_att), 0),
  -- Position's own spread + percentile ladder (per-game counting stats) — the position bars
  -- measure against how THIS position varies, not the whole league. See src/db/spread.ts.
  stddev_pop(ps.points::numeric   / ps.games_played),
  stddev_pop(ps.rebounds::numeric / ps.games_played),
  stddev_pop(ps.assists::numeric  / ps.games_played),
  stddev_pop(ps.steals::numeric   / ps.games_played),
  stddev_pop(ps.blocks::numeric   / ps.games_played),
  jsonb_build_object(
    'points',   ${pctlLadder('ps.points::float8   / ps.games_played')},
    'rebounds', ${pctlLadder('ps.rebounds::float8 / ps.games_played')},
    'assists',  ${pctlLadder('ps.assists::float8  / ps.games_played')},
    'steals',   ${pctlLadder('ps.steals::float8   / ps.games_played')},
    'blocks',   ${pctlLadder('ps.blocks::float8   / ps.games_played')}
  ),
  now()
FROM player_seasons ps
JOIN players p         ON p.id = ps.player_id
JOIN league_seasons ls ON ls.season_year = ps.season_year
WHERE ps.season_type = 2
  AND p.position IS NOT NULL
  AND ($1::int IS NULL OR ps.season_year = $1::int)
  AND ps.games_played >= $2::numeric * ls.scheduled_games
GROUP BY ps.season_year, p.position
HAVING COUNT(*) >= $3::int
`

export interface ComputePositionsOptions {
  /** Restrict the recompute to one season year. Omit to recompute every year. */
  year?: number
}

/**
 * Recompute per-season, per-position averages into position_seasons. Runs AFTER
 * computeLeague in a refresh — it reads league_seasons.scheduled_games for the small-sample
 * filter, so that table must already hold the year(s) being computed. DELETE-then-INSERT
 * (in one transaction, scoped to `year`) rather than a plain upsert, because the min-sample
 * gate means a (year, position) can legitimately appear or disappear between runs — a plain
 * upsert would leave a stale row when a bucket drops below the threshold. Does not close the
 * pool. Returns the number of position-year rows written.
 */
export async function computePositions(
  pool: Pool,
  { year }: ComputePositionsOptions = {},
): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(DELETE_SQL, [year ?? null])
    const result = await client.query(INSERT_SQL, [year ?? null, SMALL_SAMPLE_FRACTION, MIN_QUALIFIED])
    await client.query('COMMIT')
    return result.rowCount ?? 0
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
