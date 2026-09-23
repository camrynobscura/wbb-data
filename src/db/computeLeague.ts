import type { Pool } from 'pg'
import { fetchScheduledGames } from '../espn/client'
import { currentSeason } from '../seasons'
import { pctlLadder } from './spread'

// Must stay equal to the frontend's SMALL_SAMPLE_FRACTION (wnba-arc/src/lib/deviation.ts):
// the same "too few games to trust" bar decides both which player-seasons the app greys out
// AND which players qualify for these league averages. One concept, two repos — keep it paired.
export const SMALL_SAMPLE_FRACTION = 0.25

// $1 = a JSON map {season_year: real_slate} we fetched from team schedules (missing seasons
//      fall back to MAX(games_played) over single-team rows).
// $2 = the small-sample fraction; a season qualifies at >= $2 of its slate.
// $3 = optional single season year to (re)compute; NULL recomputes every year. Filtering
//      player_max scopes the whole chain, since sched/qualified derive from it.
// Besides the averages, each row records how many player-seasons qualified and how many of
// those belong to a player with a known position (migration 005). ESPN has no position for
// most pre-2012 players, so a per-position average or rank is only honest for a season where
// the two counts are equal — computePositions.ts and the API's RANK_SQL both check that here
// rather than each deciding for itself.
const SQL = `
WITH player_max AS (
  SELECT season_year,
         MAX(games_played) FILTER (WHERE team_id IS NOT NULL) AS pmax
  FROM player_seasons
  WHERE season_type = 2 AND ($3::int IS NULL OR season_year = $3::int)
  GROUP BY season_year
),
fetched AS (
  SELECT (key)::int AS season_year, (value)::int AS slate
  FROM jsonb_each_text($1::jsonb)
),
sched AS (
  SELECT pm.season_year,
         COALESCE(f.slate, pm.pmax) AS scheduled_games
  FROM player_max pm
  LEFT JOIN fetched f ON f.season_year = pm.season_year
),
qualified AS (
  SELECT ps.*, s.scheduled_games, p.position
  FROM player_seasons ps
  JOIN sched s   ON s.season_year = ps.season_year
  JOIN players p ON p.id = ps.player_id
  WHERE ps.season_type = 2
    AND ps.games_played >= $2::numeric * s.scheduled_games
)
INSERT INTO league_seasons (
  season_year, scheduled_games, qualified_players, qualified_with_position,
  avg_points, avg_rebounds, avg_assists, avg_steals, avg_blocks, avg_turnovers,
  avg_fg_pct, avg_fg3_pct,
  avg_ts_pct, avg_efg_pct, avg_tov_pct, avg_fg3a_rate, avg_ft_rate,
  stddev_points, stddev_rebounds, stddev_assists, stddev_steals, stddev_blocks,
  pctiles, updated_at
)
SELECT
  season_year,
  MAX(scheduled_games),
  COUNT(*),
  COUNT(*) FILTER (WHERE position IS NOT NULL),
  AVG(points::numeric    / games_played),
  AVG(rebounds::numeric  / games_played),
  AVG(assists::numeric   / games_played),
  AVG(steals::numeric    / games_played),
  AVG(blocks::numeric    / games_played),
  AVG(turnovers::numeric / games_played),
  SUM(fg_made)::numeric  / NULLIF(SUM(fg_att), 0),
  SUM(fg3_made)::numeric / NULLIF(SUM(fg3_att), 0),
  SUM(points)::numeric / NULLIF(2 * (SUM(fg_att) + 0.44 * SUM(ft_att)), 0),
  (SUM(fg_made) + 0.5 * SUM(fg3_made))::numeric / NULLIF(SUM(fg_att), 0),
  SUM(turnovers)::numeric / NULLIF(SUM(fg_att) + 0.44 * SUM(ft_att) + SUM(turnovers), 0),
  SUM(fg3_att)::numeric / NULLIF(SUM(fg_att), 0),
  SUM(ft_att)::numeric / NULLIF(SUM(fg_att), 0),
  -- Population spread of each per-game counting stat (the "one step" the bars measure in),
  -- and the value-at-decile ladder for the percentile tooltip. See src/db/spread.ts.
  stddev_pop(points::numeric   / games_played),
  stddev_pop(rebounds::numeric / games_played),
  stddev_pop(assists::numeric  / games_played),
  stddev_pop(steals::numeric   / games_played),
  stddev_pop(blocks::numeric   / games_played),
  jsonb_build_object(
    'points',   ${pctlLadder('points::float8   / games_played')},
    'rebounds', ${pctlLadder('rebounds::float8 / games_played')},
    'assists',  ${pctlLadder('assists::float8  / games_played')},
    'steals',   ${pctlLadder('steals::float8   / games_played')},
    'blocks',   ${pctlLadder('blocks::float8   / games_played')}
  ),
  now()
FROM qualified
GROUP BY season_year
ON CONFLICT (season_year) DO UPDATE SET
  scheduled_games = EXCLUDED.scheduled_games,
  qualified_players       = EXCLUDED.qualified_players,
  qualified_with_position = EXCLUDED.qualified_with_position,
  avg_points     = EXCLUDED.avg_points,
  avg_rebounds   = EXCLUDED.avg_rebounds,
  avg_assists    = EXCLUDED.avg_assists,
  avg_steals     = EXCLUDED.avg_steals,
  avg_blocks     = EXCLUDED.avg_blocks,
  avg_turnovers  = EXCLUDED.avg_turnovers,
  avg_fg_pct     = EXCLUDED.avg_fg_pct,
  avg_fg3_pct    = EXCLUDED.avg_fg3_pct,
  avg_ts_pct     = EXCLUDED.avg_ts_pct,
  avg_efg_pct    = EXCLUDED.avg_efg_pct,
  avg_tov_pct    = EXCLUDED.avg_tov_pct,
  avg_fg3a_rate  = EXCLUDED.avg_fg3a_rate,
  avg_ft_rate    = EXCLUDED.avg_ft_rate,
  stddev_points  = EXCLUDED.stddev_points,
  stddev_rebounds= EXCLUDED.stddev_rebounds,
  stddev_assists = EXCLUDED.stddev_assists,
  stddev_steals  = EXCLUDED.stddev_steals,
  stddev_blocks  = EXCLUDED.stddev_blocks,
  pctiles        = EXCLUDED.pctiles,
  updated_at     = now()
`

export interface ComputeLeagueOptions {
  /**
   * Restrict the recompute to a single season year. Omit to recompute every
   * year (the full-rebuild case). The scheduled refresh passes the current year:
   * past seasons' averages are frozen, so only the in-progress year needs
   * recomputing — and only its schedule slate needs fetching.
   */
  year?: number
}

/** Recompute per-season league averages into league_seasons. Does not close the pool. */
export async function computeLeague(
  pool: Pool,
  { year }: ComputeLeagueOptions = {},
): Promise<number> {
  // Which regular-season years to (re)compute? Scoped to `year` when given.
  const yearsRes = await pool.query<{ season_year: number }>(
    `SELECT DISTINCT season_year FROM player_seasons
      WHERE season_type = 2 AND ($1::int IS NULL OR season_year = $1::int)
      ORDER BY season_year`,
    [year ?? null],
  )
  const years = yearsRes.rows.map((r) => r.season_year)

  // Real slate per season from a team schedule (team 6 = LA Sparks, active since 1997). For a
  // finished season, every regular-season game that was actually played; for the in-progress
  // current season, the games completed so far, so the small-sample gate and the qualified-
  // player filter both scale to how much of the season has actually happened (a regular isn't
  // flagged small-sample just because the season is young). The rule — and why "completed"
  // alone is wrong before 2002 — is countRegularSeasonGames in src/espn/schedule.ts. See
  // wnba-arc deviation.ts (isSmallSample) — the two share SMALL_SAMPLE_FRACTION.
  const current = currentSeason()
  const slates: Record<number, number> = {}
  for (const y of years) {
    const n = await fetchScheduledGames('6', y, y === current)
    if (n) slates[y] = n
  }

  const result = await pool.query(SQL, [
    JSON.stringify(slates),
    SMALL_SAMPLE_FRACTION,
    year ?? null,
  ])
  return result.rowCount ?? 0
}
