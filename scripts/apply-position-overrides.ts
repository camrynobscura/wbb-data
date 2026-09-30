/**
 * Write the hand-read positions (src/db/positionOverrides.ts) to the live players table, for the
 * players whose position is still empty, and recompute the league and position averages for every
 * season those players have. Ingest applies the same list from now on, so this is a one-off for rows
 * that were written before the list existed — and a no-op afterwards.
 *
 *   npx tsx scripts/apply-position-overrides.ts
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
import { computeLeague } from '../src/db/computeLeague'
import { computePositions } from '../src/db/computePositions'
import { POSITION_OVERRIDES } from '../src/db/positionOverrides'

async function main(): Promise<void> {
  const pool = new Pool(dbConfig())
  const ids = Object.keys(POSITION_OVERRIDES)

  let written = 0
  for (const espnId of ids) {
    const r = await pool.query(`UPDATE players SET position = $2 WHERE espn_id = $1 AND position IS NULL`, [
      espnId,
      POSITION_OVERRIDES[espnId]!.position,
    ])
    written += r.rowCount ?? 0
  }
  console.log(`positions written: ${written} of ${ids.length} (the rest already had one)`)

  // Every regular season any of these players has — their letter counts toward each of those years.
  const years = (
    await pool.query<{ season_year: number }>(
      `SELECT DISTINCT ps.season_year FROM player_seasons ps JOIN players p ON p.id = ps.player_id
       WHERE ps.season_type = 2 AND p.espn_id = ANY($1::text[]) ORDER BY 1`,
      [ids],
    )
  ).rows.map((r) => r.season_year)
  console.log(`recomputing ${years.length} seasons: ${years.join(', ')}`)
  for (const year of years) {
    await computeLeague(pool, { year })
    const buckets = await computePositions(pool, { year })
    process.stdout.write(`  ${year}: ${buckets} position buckets\n`)
  }

  const check = await pool.query(
    `
    SELECT ls.season_year AS year, ls.qualified_players AS qualified, ls.qualified_with_position AS placed,
           (SELECT COUNT(*) FROM position_seasons p WHERE p.season_year = ls.season_year)::int AS buckets
    FROM league_seasons ls WHERE ls.season_year = ANY($1::int[]) ORDER BY 1`,
    [years],
  )
  console.table(check.rows)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
