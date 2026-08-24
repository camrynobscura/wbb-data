/**
 * Compute per-season league averages (regular season) into league_seasons. The
 * real logic lives in src/db/computeLeague.ts (shared with the scheduled refresh);
 * see there for the decisions (D3) baked into the SQL.
 *
 * Run all years:      npx tsx scripts/compute-league.ts
 * Run one year only:  npx tsx scripts/compute-league.ts 2026
 */

// Load .env for local dev; in CI (GitHub Actions) there's no file — env vars are
// injected from repo secrets — so a missing .env is normal; don't crash on it.
try {
  process.loadEnvFile()
} catch {
  /* no .env present — rely on real environment variables */
}

import { Pool } from 'pg'
import { computeLeague } from '../src/db/computeLeague'

async function main(): Promise<void> {
  const year = process.argv[2] ? Number(process.argv[2]) : undefined
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const count = await computeLeague(pool, { year })
  console.log(`✅ league_seasons upserted: ${count} seasons`)

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
