/**
 * db-ping — the "does the wire even work?" test. Connects to the database
 * (whatever DATABASE_URL points at), asks Postgres two harmless questions (its
 * version + the current time), prints the answers, and disconnects. No tables
 * touched. If this passes, our connection
 * string, the `pg` driver, and the network path are all good — so when the real
 * ingest breaks later, we KNOW it isn't the plumbing.
 *
 * Run it with:  npx tsx scripts/db-ping.ts
 */

// Node (>=20.12) can read a .env file itself — no `dotenv` package needed.
// This loads DATABASE_URL out of `.env` into process.env before we use it.
process.loadEnvFile()

// `pg` exports a `Client` (one single connection). For a throwaway ping that's
// all we need; later, real code will use a connection Pool instead.
import { Client } from 'pg'

async function main(): Promise<void> {
  // The connection string carries host, user, password, and database name.
  // `!` tells TypeScript "trust me, this is set" (loadEnvFile just filled it).
  const client = new Client({ connectionString: process.env.DATABASE_URL! })

  // Open the TCP + TLS connection and authenticate.
  await client.connect()

  // `query` sends SQL over the wire and resolves to a result. `now()` is the
  // server's clock; `version()` is the Postgres build string.
  const result = await client.query('SELECT now() AS server_time, version()')

  // `result.rows` is an array of row objects. We asked for one row.
  console.log('✅ Connected.')
  console.log('  server time:', result.rows[0].server_time)
  console.log('  version:    ', result.rows[0].version)

  // Always close, so the script exits instead of hanging on an open socket.
  await client.end()
}

main().catch((err) => {
  console.error('❌ db-ping failed:', err)
  process.exitCode = 1
})
