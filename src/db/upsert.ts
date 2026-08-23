import type { Pool } from 'pg'

/**
 * Run an INSERT … ON CONFLICT … DO UPDATE (an upsert) and return the row's id.
 *
 * `data` maps column names → values. Values are passed as query parameters (safe
 * from injection); column names are our own constants, never user input. Every
 * column that isn't part of `conflictColumns` is refreshed on conflict, and
 * `updated_at` is always bumped to now(). Building the SQL from the map keeps the
 * INSERT and the UPDATE in sync automatically — no hand-numbered placeholders.
 */
export async function upsertReturningId(
  pool: Pool,
  table: string,
  conflictColumns: string[],
  data: Record<string, unknown>,
): Promise<string> {
  const columns = Object.keys(data)
  const values = Object.values(data)
  const placeholders = columns.map((_, i) => `$${i + 1}`)

  const setClauses = [
    ...columns
      .filter((col) => !conflictColumns.includes(col))
      .map((col) => `${col} = EXCLUDED.${col}`),
    'updated_at = now()',
  ]

  const text =
    `INSERT INTO ${table} (${columns.join(', ')}, updated_at)\n` +
    `VALUES (${placeholders.join(', ')}, now())\n` +
    `ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${setClauses.join(', ')}\n` +
    `RETURNING id`

  const result = await pool.query(text, values)
  return (result.rows[0] as { id: string }).id
}
