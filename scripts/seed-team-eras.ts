/**
 * Seed team_eras with era-accurate names. For each team, fetch its name for every
 * year it appears in our data, then collapse consecutive same-name years into
 * eras (e.g. San Antonio Stars 2017 → Las Vegas Aces 2018+, same franchise id 17).
 * The most recent era gets end_year = NULL (ongoing).
 *
 * Run with:  npx tsx scripts/seed-team-eras.ts
 */
process.loadEnvFile()

import { Pool } from 'pg'
import { fetchTeamName } from '../src/espn/client'

interface Era {
  name: string
  abbreviation: string
  start_year: number
  end_year: number | null
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const teams = (await pool.query('SELECT id, espn_id FROM teams ORDER BY id')).rows

  for (const team of teams) {
    // Every year this franchise appears (canonical seasons + trade stints).
    const years: number[] = (
      await pool.query(
        `SELECT DISTINCT y FROM (
           SELECT season_year AS y FROM player_seasons WHERE team_id = $1
           UNION
           SELECT ps.season_year FROM player_season_stints st
             JOIN player_seasons ps ON ps.id = st.season_id WHERE st.team_id = $1
         ) t ORDER BY y`,
        [team.id],
      )
    ).rows.map((r) => r.y)
    if (years.length === 0) continue

    // Fetch the (era-accurate) name for each year, then group into eras.
    const eras: Era[] = []
    for (const year of years) {
      const named = await fetchTeamName(team.espn_id, year)
      if (!named) continue
      const last = eras[eras.length - 1]
      if (last && last.name === named.name) {
        last.end_year = year
      } else {
        eras.push({ ...named, start_year: year, end_year: year })
      }
    }
    if (eras.length === 0) continue
    eras[eras.length - 1]!.end_year = null // current era is ongoing

    for (const era of eras) {
      await pool.query(
        `INSERT INTO team_eras (team_id, name, abbreviation, start_year, end_year, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (team_id, start_year) DO UPDATE SET
           name = EXCLUDED.name, abbreviation = EXCLUDED.abbreviation,
           end_year = EXCLUDED.end_year, updated_at = now()`,
        [team.id, era.name, era.abbreviation, era.start_year, era.end_year],
      )
    }
    console.log(
      `team ${team.espn_id}: ` +
        eras.map((e) => `${e.name} [${e.start_year}-${e.end_year ?? 'now'}]`).join(', '),
    )
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
