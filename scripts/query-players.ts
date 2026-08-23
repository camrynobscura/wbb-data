/**
 * query-players — reads every row out of the players table and prints them.
 * The Node counterpart to running `SELECT * FROM players;` in the Neon editor:
 * same query, but the results come back as JavaScript objects our code can use.
 *
 * Run it with:  npx tsx scripts/query-players.ts
 */

process.loadEnvFile()

import { Client } from 'pg'

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL! })
  await client.connect()

  // The exact same SQL you ran in the browser.
  const result = await client.query('SELECT * FROM players')

  // result.rows is an array of row objects — one per player. Its length is the
  // row count, so we can report how many came back.
  console.log(`Got ${result.rows.length} row(s):`)

  // console.table renders an array of objects as a tidy grid in the terminal.
  console.table(result.rows)

  await client.end()
}

main().catch((err) => {
  console.error('❌ query-players failed:', err)
  process.exitCode = 1
})
