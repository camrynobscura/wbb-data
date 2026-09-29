/**
 * test-db — run the database tests (the *.db.test.ts files under src/) against a throwaway Postgres.
 *
 * With TEST_DATABASE_URL set (CI, where the workflow starts the database), runs them against that.
 * Otherwise starts a Postgres container in Docker (Docker Desktop must be running) on a free local
 * port, runs the tests, and removes the container whether they pass or fail.
 *
 * Run it with:  npm run test:db       (extra arguments go to Vitest: npm run test:db -- queries)
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { Client } from 'pg'

// Supabase's version (SHOW server_version: 17.6) and sort order: ICU, en-US (pg_database.datlocprovider
// = 'i'), which puts "A'ja" before "Aaliyah" where the image's default libc sort wouldn't. Pinned by
// digest, as the workflows pin actions; .github/workflows/ci.yml starts the same image.
const IMAGE = 'postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929'
const INITDB_ARGS = '--locale-provider=icu --icu-locale=en-US'

// Ctrl-C reaches Vitest too, which stops the run; this process notes it and carries on to remove the container.
let interrupted = false

function runTests(url: string): number {
  const args = ['vitest', 'run', '--config', 'vitest.db.config.ts', ...process.argv.slice(2)]
  const result = spawnSync('npx', args, { stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url } })
  return result.status ?? 1
}

/** Until the server takes TCP connections. The image's first start runs initdb on a socket-only server
    and then restarts, so "the port is open" alone isn't ready. */
async function waitForPostgres(url: string): Promise<void> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const client = new Client({ connectionString: url })
    try {
      await client.connect()
      await client.query('SELECT 1')
      return
    } catch (err) {
      if (interrupted) throw new Error('interrupted')
      if (Date.now() > deadline) throw new Error(`Postgres didn't start within 60 seconds: ${String(err)}`)
      await new Promise((resolve) => setTimeout(resolve, 500))
    } finally {
      await client.end().catch(() => {})
    }
  }
}

async function main(): Promise<void> {
  process.on('SIGINT', () => {
    interrupted = true
  })
  if (process.env.TEST_DATABASE_URL) {
    await waitForPostgres(process.env.TEST_DATABASE_URL)
    process.exitCode = runTests(process.env.TEST_DATABASE_URL)
    return
  }

  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' })
  } catch {
    throw new Error('Docker is not running. Start Docker Desktop, or set TEST_DATABASE_URL to a local database.')
  }

  const container = execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--env',
      'POSTGRES_PASSWORD=test',
      '--env',
      `POSTGRES_INITDB_ARGS=${INITDB_ARGS}`,
      '--publish',
      '127.0.0.1::5432', // a free port, reachable only from this machine
      IMAGE,
    ],
    { encoding: 'utf8' },
  ).trim()
  try {
    const hostPort = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split('\n')[0]
    const url = `postgres://postgres:test@${hostPort}/postgres`
    await waitForPostgres(url)
    process.exitCode = runTests(url)
  } finally {
    execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore' })
  }
}

main().catch((err) => {
  console.error('❌ test-db failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
