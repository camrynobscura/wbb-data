/**
 * Ingest one player end-to-end: fetch bio + career stats (regular + playoffs),
 * parse, write to Neon, and read back what landed.
 * Run with:  npx tsx scripts/ingest-one.ts
 */
process.loadEnvFile()

import { Pool } from 'pg'
import { parseBio, extractRawRows, groupSeasons } from '../src/espn/parse'
import { ingestPlayer } from '../src/db/ingest'

const ATHLETE_ID = '3065570' // Kelsey Plum (traded 2026 — exercises stints)

const statsUrl = (type: number) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/${ATHLETE_ID}/stats?seasontype=${type}`

async function main(): Promise<void> {
  const currentSeasonYear = new Date().getFullYear()

  // Bio from the core athlete endpoint.
  const athlete = (await (
    await fetch(
      `https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/athletes/${ATHLETE_ID}`,
    )
  ).json()) as Parameters<typeof parseBio>[0]
  const bio = parseBio(athlete)

  // Career stats: regular season (2) + playoffs (3).
  const reg = (await (await fetch(statsUrl(2))).json()) as Parameters<
    typeof extractRawRows
  >[0]
  const post = (await (await fetch(statsUrl(3))).json()) as Parameters<
    typeof extractRawRows
  >[0]
  const seasons = [
    ...groupSeasons(extractRawRows(reg), 2),
    ...groupSeasons(extractRawRows(post), 3),
  ]

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  await ingestPlayer(pool, bio, seasons, currentSeasonYear)

  const playerFilter = `player_id = (SELECT id FROM players WHERE espn_id = '${ATHLETE_ID}')`

  const seasonsBack = await pool.query(
    `SELECT season_year, season_type, team_id, games_played, points, rebounds,
            assists, ts_pct, is_total_row, is_current_season
     FROM player_seasons WHERE ${playerFilter}
     ORDER BY season_year, season_type`,
  )
  console.log(`\n${bio.name} — ${seasonsBack.rows.length} season rows:`)
  console.table(seasonsBack.rows)

  const stintsBack = await pool.query(
    `SELECT ps.season_year, st.team_id, st.games_played, st.points
     FROM player_season_stints st
     JOIN player_seasons ps ON ps.id = st.season_id
     WHERE ps.${playerFilter}
     ORDER BY ps.season_year, st.team_id`,
  )
  console.log('stints:')
  console.table(stintsBack.rows)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
