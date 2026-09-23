/**
 * 2nd pass, standalone: backfill minutes + USG%/AST% across seasons. The real
 * logic lives in src/db/backfillRoles.ts (shared with the scheduled refresh).
 *
 * Run all seasons:               npx tsx scripts/backfill-roles.ts
 * Run one season only:           npx tsx scripts/backfill-roles.ts 2026
 * Only seasons missing minutes:  npx tsx scripts/backfill-roles.ts --missing-only
 *                                (after adding players — skips the seasons already filled)
 */

// Load .env for local dev; in CI (GitHub Actions) there's no file — env vars are
// injected from repo secrets — so a missing .env is normal; don't crash on it.
try {
  process.loadEnvFile()
} catch {
  /* no .env present — rely on real environment variables */
}

import { Pool } from 'pg'
import { backfillRoles } from '../src/db/backfillRoles'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const missingOnly = argv.includes('--missing-only')
  const yearArg = argv.find((arg) => /^\d+$/.test(arg))
  const year = yearArg ? Number(yearArg) : undefined
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  console.log(
    `backfilling ${year ? `${year}` : 'all'} seasons${missingOnly ? ' still missing minutes' : ''}...`,
  )
  const { seasons, rolesFilled } = await backfillRoles(pool, { year, missingOnly })
  console.log(`✅ backfill done: ${seasons} seasons, ${rolesFilled} with role rates`)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
