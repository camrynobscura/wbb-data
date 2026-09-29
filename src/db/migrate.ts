import { readdirSync, readFileSync } from 'node:fs'
import type { ClientBase } from 'pg'

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url)

/**
 * Apply pending schema migrations, in order, exactly once each:
 *   1. Ensure a schema_migrations table exists (the checklist of what's run).
 *   2. Read every migrations/*.sql file, sorted by name (zero-padded numbers → order).
 *   3. Run any whose filename isn't in the checklist yet — each in its own transaction,
 *      recording it in the same transaction, so a failure rolls back and isn't marked done.
 *
 * Safe to run repeatedly: already-applied migrations are skipped. Forward-only (no
 * down migrations) — deliberate for a small solo project. Used by scripts/migrate.ts and by
 * the database tests, which build their schema the same way. Returns the files applied.
 */
export async function applyMigrations(
  client: ClientBase,
  onApplied: (file: string) => void = () => {},
): Promise<string[]> {
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
  const ran: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`migration ${file} failed (rolled back): ${String(err)}`)
    }
    onApplied(file)
    ran.push(file)
  }
  return ran
}
