/**
 * Compute per-season league averages (regular season) into league_seasons, from
 * data already in player_seasons plus a per-season schedule fetch. Decisions (D3):
 *  - scheduled_games = the real slate, fetched per season from a team's schedule
 *    (fetchScheduledGames), NOT inferred from our player sample. Finished seasons
 *    count games actually played (drops a postponed-never-replayed game, e.g. the
 *    2020 walkout → 22); the in-progress season counts all scheduled games incl.
 *    future dates (full slate → 44). Falls back to MAX(games_played) over single-
 *    team rows for any season whose fetch fails.
 *  - qualified = games_played >= SMALL_SAMPLE_FRACTION of the slate — kept equal to the
 *    frontend's SMALL_SAMPLE_FRACTION (wnba-arc/src/lib/deviation.ts) so the "too small a
 *    sample" bar is one number app-wide, not two that can drift apart
 *  - counting stats = mean of per-game values across qualified players
 *  - rate stats = from league TOTALS (sum makes / sum attempts), not a mean of rates
 *
 * Run with:  npx tsx scripts/compute-league.ts
 */
process.loadEnvFile()

import { Pool } from 'pg'
import { fetchScheduledGames } from '../src/espn/client'

// Must stay equal to the frontend's SMALL_SAMPLE_FRACTION (wnba-arc/src/lib/deviation.ts):
// the same "too few games to trust" bar decides both which player-seasons the app greys out
// AND which players qualify for these league averages. One concept, two repos — keep it paired.
const SMALL_SAMPLE_FRACTION = 0.25

// $1 = a JSON map {season_year: real_slate} we fetched from team schedules (missing seasons
//      fall back to MAX(games_played) over single-team rows).
// $2 = the small-sample fraction above; a season qualifies at >= $2 of its slate.
const SQL = `
WITH player_max AS (
  SELECT season_year,
         MAX(games_played) FILTER (WHERE team_id IS NOT NULL) AS pmax
  FROM player_seasons WHERE season_type = 2
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
  SELECT ps.*, s.scheduled_games
  FROM player_seasons ps
  JOIN sched s ON s.season_year = ps.season_year
  WHERE ps.season_type = 2
    AND ps.games_played >= $2::numeric * s.scheduled_games
)
INSERT INTO league_seasons (
  season_year, scheduled_games,
  avg_points, avg_rebounds, avg_assists, avg_steals, avg_blocks, avg_turnovers,
  avg_fg_pct, avg_fg3_pct,
  avg_ts_pct, avg_efg_pct, avg_tov_pct, avg_fg3a_rate, avg_ft_rate, updated_at
)
SELECT
  season_year,
  MAX(scheduled_games),
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
  now()
FROM qualified
GROUP BY season_year
ON CONFLICT (season_year) DO UPDATE SET
  scheduled_games = EXCLUDED.scheduled_games,
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
  updated_at     = now()
`

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const currentYear = new Date().getFullYear()

  // Which regular-season years do we have data for?
  const yearsRes = await pool.query<{ season_year: number }>(
    `SELECT DISTINCT season_year FROM player_seasons
      WHERE season_type = 2 ORDER BY season_year`,
  )
  const years = yearsRes.rows.map((r) => r.season_year)

  // Real slate per season from a team schedule (team 6 = LA Sparks, active since 1997).
  // Past seasons: completed games only; the current season: full scheduled slate.
  const slates: Record<number, number> = {}
  for (const y of years) {
    const n = await fetchScheduledGames('6', y, y !== currentYear)
    if (n) slates[y] = n
  }
  console.log('fetched slates:', slates)

  const result = await pool.query(SQL, [JSON.stringify(slates), SMALL_SAMPLE_FRACTION])
  console.log(`✅ league_seasons upserted: ${result.rowCount} seasons`)

  const check = await pool.query(`
    SELECT season_year, scheduled_games,
           round(avg_points,1) AS ppg, round(avg_rebounds,1) AS rpg,
           round(avg_assists,1) AS apg, round(avg_ts_pct,3) AS ts,
           round(avg_efg_pct,3) AS efg
    FROM league_seasons ORDER BY season_year DESC`)
  console.table(check.rows)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
