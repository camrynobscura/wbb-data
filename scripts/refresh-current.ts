/**
 * The scheduled refresh — current season only. This is what GitHub Actions runs
 * on a cron. Historical seasons never change, so it touches only the in-progress
 * year: discover the current player universe, re-ingest each player's current-year
 * row (and refresh their bio), hand the "in progress" flag over to the current
 * year, then rebuild the current year's role rates and league averages.
 *
 * Everything keys off new Date().getFullYear() and a rolling discovery window, so
 * it rolls into the next season on its own with no code change (see DECISIONS).
 *
 * Run:              npx tsx scripts/refresh-current.ts
 * Run first N only:  npx tsx scripts/refresh-current.ts 5     (handy for testing)
 */

// Load .env for local dev; in CI (GitHub Actions) there's no file — env vars are
// injected from repo secrets — so a missing .env is normal; don't crash on it.
try {
  process.loadEnvFile()
} catch {
  /* no .env present — rely on real environment variables */
}

import { Pool } from 'pg'
import {
  discoverCurrentAppearances,
  fetchBio,
  fetchCurrentTeams,
  fetchLastGameDate,
  fetchSeasons,
  recoverSeasons,
} from '../src/espn/client'
import { ingestPlayer } from '../src/db/ingest'
import { backfillRoles } from '../src/db/backfillRoles'
import { computeLeague } from '../src/db/computeLeague'
import { computePositions } from '../src/db/computePositions'
import { startScrapeRun, finishScrapeRun } from '../src/db/scrapeRuns'
import { mapWithConcurrency } from '../src/util/concurrency'
import {
  FEATURED_ESPN_IDS,
  snapshotIdentities,
  diffIdentities,
  diffTeamNames,
  findUnnamedTeams,
  loadOpenEras,
} from '../src/notify/watch'
import { formatAlert, sendAlert } from '../src/notify/send'

const CONCURRENCY = 5

async function main(): Promise<void> {
  const limitArg = process.argv[2] ? Number(process.argv[2]) : undefined
  const currentYear = new Date().getFullYear()

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const runId = await startScrapeRun(pool)

  let done = 0
  let failed = 0
  let skipped = 0

  try {
    // Snapshot the featured players' identity BEFORE ingest overwrites it, so we
    // can tell afterward what this run changed (name/position/team).
    const before = await snapshotIdentities(pool, FEATURED_ESPN_IDS)

    const appearances = await discoverCurrentAppearances(currentYear)
    let ids = [...appearances.keys()]
    if (limitArg) ids = ids.slice(0, limitArg)
    console.log(
      `discovered ${ids.length} current players; refreshing ${currentYear} rows ` +
        `(concurrency ${CONCURRENCY})...`,
    )

    await mapWithConcurrency(ids, CONCURRENCY, async (id) => {
      try {
        const [bio, fromStats] = await Promise.all([fetchBio(id), fetchSeasons(id)])
        // A current-year appearance /stats doesn't return yet (an all-zero cameo — see
        // fetchSeasonFromCore) is recovered from the core endpoint; only this year's, since
        // only this year's rows are written.
        const thisYear = (appearances.get(id) ?? []).filter((a) => a.year === currentYear)
        const seasons = [...fromStats, ...(await recoverSeasons(id, fromStats, thisYear))]
        // Only the current season changes; ingest just that year's row(s). The
        // player bio is always upserted (name/team/position kept fresh) even when
        // there's no current-year row yet — that's what the change notifier reads.
        if (seasons.length === 0) {
          // No stats rows at all (no ESPN career page, or averages with no totals): nothing
          // the app could show, so she isn't stored — the same rule as scrape.ts.
          skipped++
        } else {
          const currentSeasons = seasons.filter((s) => s.year === currentYear)
          await ingestPlayer(pool, bio, currentSeasons, currentYear)
          done++
        }
      } catch (err) {
        failed++
        console.error(`  player ${id} failed: ${String(err)}`)
      }
      const processed = done + failed + skipped
      if (processed % 25 === 0) {
        console.log(`  ${processed}/${ids.length} (${failed} failed)`)
      }
    })

    // Hand the "in progress" flag to the current year. Ingest sets it true on the
    // rows it just wrote; this clears it on any prior year still carrying it — the
    // one thing current-season-only scope wouldn't fix on its own at the rollover.
    const cleared = await pool.query(
      `UPDATE player_seasons SET is_current_season = false
        WHERE season_year <> $1 AND is_current_season`,
      [currentYear],
    )
    console.log(`cleared stale is_current_season on ${cleared.rowCount ?? 0} row(s)`)

    // 2nd pass + league averages, scoped to the current year only.
    const { seasons, rolesFilled } = await backfillRoles(pool, { year: currentYear })
    console.log(`backfilled ${seasons} ${currentYear} season(s), ${rolesFilled} with role rates`)

    const leagueCount = await computeLeague(pool, { year: currentYear })
    console.log(`recomputed league averages for ${leagueCount} season(s)`)

    // Position averages depend on league_seasons.scheduled_games (just recomputed above), so
    // this must run after computeLeague.
    const positionCount = await computePositions(pool, { year: currentYear })
    console.log(`recomputed position averages: ${positionCount} (year, position) row(s)`)

    // "Stats through …" for the footer: the latest completed regular-season game across this
    // season's teams' schedules. Non-fatal — a null here just makes /meta serve the last run's.
    let lastGameDate: string | null = null
    try {
      // Every team with a regular-season row this year: the season's team, plus each stint's
      // team for traded players (stints hang off the season row — they carry no year themselves).
      const { rows: teamRows } = await pool.query<{ team_id: string }>(
        `SELECT DISTINCT team_id::text AS team_id FROM player_seasons
          WHERE season_year = $1 AND season_type = 2 AND team_id IS NOT NULL
         UNION
         SELECT DISTINCT st.team_id::text FROM player_season_stints st
           JOIN player_seasons ps ON ps.id = st.season_id
          WHERE ps.season_year = $1 AND ps.season_type = 2`,
        [currentYear],
      )
      const teamIds = teamRows.map((r) => r.team_id)
      lastGameDate = await fetchLastGameDate(teamIds, currentYear)
      console.log(`stats through ${lastGameDate ?? '(unknown)'} (${teamIds.length} team schedules)`)
    } catch (dateErr) {
      console.error(`last-game-date step failed (non-fatal): ${String(dateErr)}`)
    }

    // Heads-up notification (must never fail the run — the data refresh is done).
    // Diff the featured players' identity, flag un-named new teams and renamed ones; ping
    // Discord if there's anything to act on. No webhook configured → just log.
    try {
      const after = await snapshotIdentities(pool, FEATURED_ESPN_IDS)
      const changes = diffIdentities(before, after)
      const unnamedTeams = await findUnnamedTeams(pool)
      // A rename / relocation keeps ESPN's franchise id and our open era covers every future
      // year, so only the NAME changes — compare ESPN's current teams to the open eras. A failed
      // teams request means "couldn't check" (logged), not "nothing renamed".
      const espnTeams = await fetchCurrentTeams()
      if (espnTeams == null) console.error('team-name check skipped: ESPN teams list unavailable')
      const renamedTeams = espnTeams ? diffTeamNames(espnTeams, await loadOpenEras(pool)) : []
      const alert = formatAlert(changes, unnamedTeams, renamedTeams)
      if (!alert) {
        console.log('no featured-player or team changes to report')
      } else {
        console.log(alert)
        const via = await sendAlert(alert)
        console.log(
          via === 'none'
            ? '(no TELEGRAM_URL or DISCORD_WEBHOOK_URL set — skipped sending)'
            : `→ notification sent via ${via}`,
        )
      }
    } catch (notifyErr) {
      console.error(`notification step failed (non-fatal): ${String(notifyErr)}`)
    }

    await finishScrapeRun(
      pool,
      runId,
      'success',
      done,
      failed ? `${failed} players failed` : undefined,
      lastGameDate,
    )
    console.log(`✅ refresh complete: ${done} players, ${skipped} skipped (no stats), ${failed} failed`)
  } catch (err) {
    await finishScrapeRun(pool, runId, 'error', done, String(err))
    throw err
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
