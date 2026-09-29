/**
 * Fill team_season_games (migration 008): each team's regular-season game count per season. The
 * logic lives in src/db/teamGames.ts (shared with the daily refresh). A finished season comes from ESPN
 * team statistics (+ the hand-checked corrections; the season total where ESPN has none); the
 * season in progress from each team's schedule.
 *
 * Run all years:      npx tsx scripts/fill-team-games.ts
 * Run one year only:  npx tsx scripts/fill-team-games.ts 2018
 *
 * Order on a full rebuild: compute-league (the season totals this falls back on) → this →
 * compute-league again and compute-positions (their pools read these rows). After a season ends,
 * run this for that year once the calendar turns, so its rows come from team statistics too.
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
import { seasonTeams } from '../src/db/teams'
import { fillFinishedTeamGames, refreshCurrentTeamGames } from '../src/db/teamGames'
import { currentSeason } from '../src/seasons'

async function main(): Promise<void> {
  const year = process.argv[2] ? Number(process.argv[2]) : undefined
  const pool = new Pool(dbConfig())
  const current = currentSeason()

  const teams = await seasonTeams(pool, year)
  const finished = teams.filter((t) => t.year !== current)
  const inProgress = teams.filter((t) => t.year === current)
  console.log(`team-seasons: ${teams.length} (${finished.length} finished, ${inProgress.length} in ${current})`)

  if (finished.length > 0) {
    const f = await fillFinishedTeamGames(pool, finished)
    console.log('finished seasons written, by source:', f.bySource)
    if (f.missing.length > 0) {
      console.error(
        `⚠️  no count for ${f.missing.length}: ${f.missing.map((t) => `${t.year} espn ${t.espnId}`).join(', ')}`,
      )
    }
  }
  if (inProgress.length > 0) {
    const c = await refreshCurrentTeamGames(pool, inProgress)
    console.log(
      `${current} (in progress) written from schedules: ${c.written}; failed: ${c.failed.join(', ') || 'none'}`,
    )
  }

  // Every team-season that differs from its season's total — the few that matter.
  const diff = await pool.query(`
    SELECT tg.season_year, e.name, tg.games, ls.scheduled_games AS season_total, tg.source
      FROM team_season_games tg
      JOIN league_seasons ls ON ls.season_year = tg.season_year
      LEFT JOIN team_eras e ON e.team_id = tg.team_id
       AND tg.season_year BETWEEN e.start_year AND COALESCE(e.end_year, 9999)
     WHERE tg.games <> ls.scheduled_games
     ORDER BY tg.season_year, e.name`)
  console.log(`team-seasons that differ from their season total: ${diff.rowCount}`)
  if (diff.rowCount) console.table(diff.rows)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
