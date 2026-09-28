/**
 * The full scrape: discover the player universe (Pass A), then ingest each
 * player (Pass B) with bounded concurrency and a scrape_runs audit row.
 *
 * The rolling window (D1):      npx tsx scripts/scrape.ts
 * The whole league, 1997→:      npx tsx scripts/scrape.ts --all
 * Retry the ids in a file:      npx tsx scripts/scrape.ts --ids data/scrape-failed-42.txt
 * Only the first N (testing):   npx tsx scripts/scrape.ts 5        (combines with --all)
 *
 * Every write is an idempotent upsert, so a rerun is always safe. Ids that fail are
 * written to data/scrape-failed-<run>.txt (git-ignored), so the retry is `--ids <that
 * file>` rather than a fresh discovery.
 */
// Load .env for local dev; in CI (GitHub Actions) there's no file — env vars are
// injected from repo secrets — so a missing .env is normal; don't crash on it.
try {
  process.loadEnvFile()
} catch {
  /* no .env present — rely on real environment variables */
}

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { dbConfig } from '../src/db/connect'
import {
  discoverAllAppearances,
  discoverCurrentAppearances,
  fetchBio,
  fetchSeasons,
  recoverSeasons,
} from '../src/espn/client'
import { ingestPlayer } from '../src/db/ingest'
import { startScrapeRun, finishScrapeRun } from '../src/db/scrapeRuns'
import { mapWithConcurrency } from '../src/util/concurrency'
import { currentSeason, FIRST_WNBA_SEASON, ROSTER_WINDOW_YEARS } from '../src/seasons'

const CONCURRENCY = 5
const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url))

interface Args {
  all: boolean
  idsFile?: string
  limit?: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = { all: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--all') {
      args.all = true
    } else if (arg === '--ids') {
      args.idsFile = argv[++i]
      if (!args.idsFile) throw new Error('--ids needs a file path')
    } else if (/^\d+$/.test(arg)) {
      args.limit = Number(arg)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const currentYear = currentSeason()

  const pool = new Pool(dbConfig())
  const runId = await startScrapeRun(pool)

  let done = 0
  let recoveredSeasons = 0
  const failedIds: string[] = []
  const noSeasons: string[] = []

  try {
    // Discovery gives the universe AND each player's appearances (which seasons, how many
    // games) — the record the fallback checks /stats against. A retry from a file still
    // discovers, for the appearances; 60 quick list fetches.
    const appearances =
      args.all || args.idsFile
        ? await discoverAllAppearances(currentYear)
        : await discoverCurrentAppearances(currentYear)
    let ids: string[]
    if (args.idsFile) {
      ids = readFileSync(args.idsFile, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      console.log(`retrying ${ids.length} ids from ${args.idsFile}`)
    } else {
      ids = [...appearances.keys()]
      const span = args.all
        ? `every season since ${FIRST_WNBA_SEASON}`
        : `the last ${ROSTER_WINDOW_YEARS} seasons`
      console.log(`discovered ${ids.length} players across ${span}`)
    }
    if (args.limit) ids = ids.slice(0, args.limit)
    console.log(`ingesting ${ids.length} players (concurrency ${CONCURRENCY})...`)

    await mapWithConcurrency(ids, CONCURRENCY, async (id) => {
      try {
        const [bio, fromStats] = await Promise.all([
          fetchBio(id),
          fetchSeasons(id),
        ])
        // Seasons the lists say she played but /stats didn't return (see fetchSeasonFromCore).
        const recovered = await recoverSeasons(id, fromStats, appearances.get(id) ?? [])
        recoveredSeasons += recovered.length
        const seasons = [...fromStats, ...recovered]
        if (seasons.length === 0) {
          // No stats rows at all — ESPN has no career page for her, or only averages with
          // no totals. Nothing the app could show, so she isn't stored (D6: played = a row
          // exists). Reported, not counted as a failure.
          noSeasons.push(id)
        } else {
          await ingestPlayer(pool, bio, seasons, currentYear)
          done++
        }
      } catch (err) {
        failedIds.push(id)
        console.error(`  player ${id} failed: ${String(err)}`)
      }
      const processed = done + failedIds.length + noSeasons.length
      if (processed % 25 === 0) {
        console.log(`  ${processed}/${ids.length} (${failedIds.length} failed)`)
      }
    })

    let failureNote: string | undefined
    if (failedIds.length > 0) {
      mkdirSync(DATA_DIR, { recursive: true })
      const file = `${DATA_DIR}scrape-failed-${runId}.txt`
      writeFileSync(file, failedIds.join('\n') + '\n')
      failureNote = `${failedIds.length} players failed (ids in ${file})`
      console.error(failureNote)
    }

    if (noSeasons.length > 0) {
      console.log(`skipped ${noSeasons.length} with no stats on ESPN: ${noSeasons.join(', ')}`)
    }
    console.log(`recovered ${recoveredSeasons} season(s) the career endpoint lacked`)
    await finishScrapeRun(pool, runId, 'success', done, failureNote)
    console.log(
      `✅ scrape complete: ${done} ingested, ${noSeasons.length} skipped (no stats), ${failedIds.length} failed`,
    )
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
