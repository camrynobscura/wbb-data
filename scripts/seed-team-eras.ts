/**
 * Seed team_eras with era-accurate names. For each franchise, fetch ESPN's name for every
 * year it appears in our data, then collapse consecutive same-name years into eras (Detroit
 * Shock 1998–2009 → Tulsa Shock 2010–2015 → Dallas Wings 2016–, one franchise id). Rules,
 * learned from the full-history data (2026-09-23):
 *   - an era's abbreviation is its LATEST year's — today's code is what the frontend keys
 *     team tints on (the Sparks are "LA" now; ESPN's 1997 record says "LOS");
 *   - a gap in the team's seasons starts a new era even under the same name — ESPN reuses
 *     id 132052 for the Portland Fire of 2000–02 and the new one of 2026 (two eras, not one
 *     "2000–now", which would give the franchise two current eras);
 *   - a franchise with no data in the league's latest season is DEFUNCT: its final era ends
 *     in its last year instead of running to "now", so player_current_team never resolves
 *     to the Houston Comets;
 *   - a couple of ESPN's historical codes are another city's or malformed — overridden below.
 * Each team's eras are replaced wholesale (delete + insert in one transaction), so a rerun
 * after new seasons arrive can't leave a stale, overlapping era behind.
 *
 * Run with:  npx tsx scripts/seed-team-eras.ts
 */
// Load .env for local dev; in CI (GitHub Actions) there's no file — env vars are
// injected from repo secrets — so a missing .env is normal; don't crash on it.
try {
  process.loadEnvFile()
} catch {
  /* no .env present — rely on real environment variables */
}

import { Pool } from 'pg'
import { dbConfig } from '../src/db/connect'
import { fetchTeamName } from '../src/espn/client'

/** ESPN's name for a (team, year) → the era's real name, where ESPN's record is off. */
const NAME_OVERRIDES: Record<string, string> = {
  Charlotte: 'Charlotte Sting', // ESPN's 1997 record drops the nickname; the Sting played 1997–2006
}

/** Era name → the code it is known by, where ESPN's differs. Everything else is ESPN's own. */
const ABBREVIATION_OVERRIDES: Record<string, string> = {
  // The code this database has always served and the frontend keys team tints on
  // (wnba-arc src/data/teams.ts); ESPN's current record says PHX. Keep the contract.
  'Phoenix Mercury': 'PHO',
  'Detroit Shock': 'DET', // ESPN gives TUL — the franchise's later Tulsa code
  'Sacramento Monarchs': 'SAC', // ESPN gives SACRA for the franchise's first id (2793)
}

interface Era {
  name: string
  abbreviation: string
  start_year: number
  end_year: number | null
}

async function main(): Promise<void> {
  const pool = new Pool(dbConfig())
  const teams = (await pool.query('SELECT id, espn_id FROM teams ORDER BY id')).rows

  // The league's latest season on record. A franchise without data in it is defunct.
  const latest = Number(
    (await pool.query('SELECT MAX(season_year) AS y FROM player_seasons')).rows[0].y,
  )

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

    // Fetch the (era-accurate) name for each year, then group into eras. A gap is judged on
    // the team's DATA years, so a year ESPN can't name doesn't split an era by itself.
    const eras: Era[] = []
    let previousYear: number | null = null
    for (const year of years) {
      const gap = previousYear !== null && year !== previousYear + 1
      previousYear = year
      const fetched = await fetchTeamName(team.espn_id, year)
      if (!fetched) continue
      const named = { ...fetched, name: NAME_OVERRIDES[fetched.name] ?? fetched.name }
      const last = eras[eras.length - 1]
      if (last && last.name === named.name && !gap) {
        last.end_year = year
        last.abbreviation = named.abbreviation // the latest year's code wins
      } else {
        eras.push({ ...named, start_year: year, end_year: year })
      }
    }
    if (eras.length === 0) continue

    for (const era of eras) {
      era.abbreviation = ABBREVIATION_OVERRIDES[era.name] ?? era.abbreviation
    }
    const final = eras[eras.length - 1]!
    if (final.end_year === latest) final.end_year = null // still playing → the era is ongoing

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM team_eras WHERE team_id = $1', [team.id])
      for (const era of eras) {
        await client.query(
          `INSERT INTO team_eras (team_id, name, abbreviation, start_year, end_year, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [team.id, era.name, era.abbreviation, era.start_year, era.end_year],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    console.log(
      `team ${team.espn_id}: ` +
        eras
          .map((e) => `${e.name} (${e.abbreviation}) [${e.start_year}-${e.end_year ?? 'now'}]`)
          .join(', '),
    )
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
