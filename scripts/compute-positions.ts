/**
 * Compute per-season, per-position averages (regular season) into position_seasons — the
 * "compare to same position" baseline. Real logic lives in src/db/computePositions.ts
 * (shared with the scheduled refresh). Requires league_seasons to be populated first
 * (it reads scheduled_games from there), so run compute-league before a full rebuild.
 *
 * Run all years:      npx tsx scripts/compute-positions.ts
 * Run one year only:  npx tsx scripts/compute-positions.ts 2026
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
import { computePositions } from '../src/db/computePositions'

async function main(): Promise<void> {
  const year = process.argv[2] ? Number(process.argv[2]) : undefined
  const pool = new Pool(dbConfig())

  const count = await computePositions(pool, { year })
  console.log(`✅ position_seasons written: ${count} rows`)

  const check = await pool.query(`
    SELECT season_year, position, qualified_players AS n,
           round(avg_points,1) AS ppg, round(avg_rebounds,1) AS rpg,
           round(avg_assists,1) AS apg, round(avg_ts_pct,3) AS ts
    FROM position_seasons ORDER BY season_year DESC, position`)
  console.table(check.rows)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
