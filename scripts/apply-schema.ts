/**
 * apply-schema — reads db/schema.sql and runs it against the database, creating
 * every table, constraint, and index in one shot. Safe to think of as "install
 * the schema." Right now schema.sql has no DROPs, so re-running it on an
 * already-created database will error ("relation already exists") — that's
 * expected; we'll add a proper migration story later.
 *
 * Run it with:  npx tsx scripts/apply-schema.ts
 */

process.loadEnvFile()

import { readFileSync } from 'node:fs'
import { Client } from 'pg'

async function main(): Promise<void> {
  // Read the SQL file off disk as one big string. This is YOUR schema — this
  // script just delivers it; it doesn't change a character.
  const sql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')

  const client = new Client({ connectionString: process.env.DATABASE_URL! })
  await client.connect()

  // A single query() with multiple statements runs them in order. If any one
  // fails, Postgres stops there and throws — we'll see exactly which.
  await client.query(sql)

  console.log('✅ Schema applied.')
  await client.end()
}

main().catch((err) => {
  console.error('❌ apply-schema failed:', err)
  process.exitCode = 1
})
