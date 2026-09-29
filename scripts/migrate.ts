/**
 * migrate — apply pending schema migrations, in order, exactly once each (src/db/migrate.ts
 * has how).
 *
 * Run it with:  npx tsx scripts/migrate.ts
 */

// Load .env for local dev; in CI (GitHub Actions) there's no file — env vars are
// injected from repo secrets — so a missing .env is normal; don't crash on it.
try {
  process.loadEnvFile()
} catch {
  /* no .env present — rely on real environment variables */
}

import { Client } from 'pg'
import { dbConfig } from '../src/db/connect'
import { applyMigrations } from '../src/db/migrate'

async function main(): Promise<void> {
  const client = new Client(dbConfig())
  await client.connect()

  try {
    const ran = await applyMigrations(client, (file) => console.log(`applied ${file}`))
    console.log(ran.length ? `✅ applied ${ran.length} migration(s)` : '✅ up to date (nothing to apply)')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('❌ migrate failed:', err)
  process.exitCode = 1
})
