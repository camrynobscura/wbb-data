/**
 * Checks the database connection: connects to whatever DATABASE_URL points at, asks Postgres for its
 * version and the time, and disconnects. No tables touched, so when an ingest breaks, this rules the
 * connection in or out.
 *
 * Run it with:  npx tsx scripts/db-ping.ts
 */

process.loadEnvFile()

// One connection is all a ping needs; the API and ingest use a Pool.
import { Client } from 'pg'
import { dbConfig } from '../src/db/connect'

async function main(): Promise<void> {
  // dbConfig adds the encryption settings (src/db/connect.ts) and throws if DATABASE_URL isn't set.
  const client = new Client(dbConfig())
  await client.connect()
  const result = await client.query('SELECT now() AS server_time, version()')
  console.log('✅ Connected.')
  console.log('  server time:', result.rows[0].server_time)
  console.log('  version:    ', result.rows[0].version)

  await client.end() // or the script hangs on the open socket
}

main().catch((err) => {
  console.error('❌ db-ping failed:', err)
  process.exitCode = 1
})
