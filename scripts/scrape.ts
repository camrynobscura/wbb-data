/**
 * The full scrape: discover the player universe (Pass A), then ingest each
 * player (Pass B) with bounded concurrency and a scrape_runs audit row.
 *
 * Run all:          npx tsx scripts/scrape.ts
 * Run first N only:  npx tsx scripts/scrape.ts 5      (handy for testing)
 */
// Load .env for local dev; in CI (GitHub Actions) there's no file — env vars are
// injected from repo secrets — so a missing .env is normal; don't crash on it.
try {
  process.loadEnvFile()
} catch {
  /* no .env present — rely on real environment variables */
}

import { Pool } from 'pg'
import { discoverPlayerIds, fetchBio, fetchSeasons } from '../src/espn/client'
import { ingestPlayer } from '../src/db/ingest'
import { startScrapeRun, finishScrapeRun } from '../src/db/scrapeRuns'
import { mapWithConcurrency } from '../src/util/concurrency'

const CONCURRENCY = 5

async function main(): Promise<void> {
  const limitArg = process.argv[2] ? Number(process.argv[2]) : undefined
  const currentYear = new Date().getFullYear()

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const runId = await startScrapeRun(pool)

  let done = 0
  let failed = 0

  try {
    let ids = await discoverPlayerIds(currentYear)
    if (limitArg) ids = ids.slice(0, limitArg)
    console.log(
      `discovered ${ids.length} players; ingesting (concurrency ${CONCURRENCY})...`,
    )

    await mapWithConcurrency(ids, CONCURRENCY, async (id) => {
      try {
        const [bio, seasons] = await Promise.all([
          fetchBio(id),
          fetchSeasons(id),
        ])
        await ingestPlayer(pool, bio, seasons, currentYear)
        done++
      } catch (err) {
        failed++
        console.error(`  player ${id} failed: ${String(err)}`)
      }
      const processed = done + failed
      if (processed % 25 === 0) {
        console.log(`  ${processed}/${ids.length} (${failed} failed)`)
      }
    })

    await finishScrapeRun(
      pool,
      runId,
      'success',
      done,
      failed ? `${failed} players failed` : undefined,
    )
    console.log(`✅ scrape complete: ${done} ingested, ${failed} failed`)
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
