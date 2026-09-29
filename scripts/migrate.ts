/**
 * migrate — apply pending schema migrations, in order, exactly once each.
 *
 * How it works:
 *   1. Ensure a schema_migrations table exists (the checklist of what's run).
 *   2. Read every migrations/*.sql file, sorted by name (zero-padded numbers → order).
 *   3. Run any whose filename isn't in the checklist yet — each in its own transaction,
 *      recording it in the same transaction, so a failure rolls back and isn't marked done.
 *
 * Safe to run repeatedly: already-applied migrations are skipped. Forward-only (no
 * down migrations) — deliberate for a small solo project.
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

import { readdirSync, readFileSync } from 'node:fs'
import { Client } from 'pg'
import { dbConfig } from '../src/db/connect'

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url)

async function main(): Promise<void> {
  const client = new Client(dbConfig())
  await client.connect()

  try {
    // 1. The checklist of applied migrations (version = the .sql filename).
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations')
    const applied = new Set(rows.map((r) => r.version))

    // 2. All migration files, in filename order.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    // 3. Run the pending ones, each atomically.
    let ran = 0
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8')
      process.stdout.write(`applying ${file}... `)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log('done')
        ran++
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${file} failed (rolled back): ${String(err)}`)
      }
    }

    console.log(ran ? `✅ applied ${ran} migration(s)` : '✅ up to date (nothing to apply)')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('❌ migrate failed:', err)
  process.exitCode = 1
})
