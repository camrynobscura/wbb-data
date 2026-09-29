// Load .env for local dev; on a host like Render there's no file (env vars are injected
// into the environment), so a missing .env is normal — don't crash on it.
try {
  process.loadEnvFile()
} catch {
  /* no .env present — rely on real environment variables */
}
import { Pool } from 'pg'
import { createApp } from './app'
import { dbConfig } from '../db/connect'

// Pool tuning: cap connections well under Supabase's pooler limit, and give up on a
// stuck connection or a hung query instead of leaking one forever.
const pool = new Pool({
  ...dbConfig(), // encrypted and certificate-checked for Supabase (src/db/connect.ts)
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000, // Postgres cancels any query running longer than 10s
})
// pg-pool re-emits an idle client's socket error on the pool, and an 'error' event with no listener
// throws, which took the whole process down (`read ETIMEDOUT` on an idle Supabase connection after ~35
// minutes up). The pool drops the dead client on its own; log and go on.
pool.on('error', (err) => {
  console.error('[pg pool] idle client error (client discarded):', err.message)
})

const PORT = Number(process.env.PORT) || 3001

createApp(pool, process.env.CORS_ORIGIN).listen(PORT, () => {
  console.log(`server is listening on ${PORT}`)
})
