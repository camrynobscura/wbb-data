/**
 * Prints every row of the players table.
 *
 * Run it with:  npx tsx scripts/query-players.ts
 */

process.loadEnvFile()

import { Client } from 'pg'
import { dbConfig } from '../src/db/connect'

async function main(): Promise<void> {
  const client = new Client(dbConfig())
  await client.connect()

  const result = await client.query('SELECT * FROM players')
  console.log(`Got ${result.rows.length} row(s):`)
  console.table(result.rows)
  await client.end()
}

main().catch((err) => {
  console.error('❌ query-players failed:', err)
  process.exitCode = 1
})
