import { readdirSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { applyMigrations } from './migrate'
import { openTestPool } from '../test/db'

const pool = openTestPool()
afterAll(() => pool.end())

describe('applyMigrations', () => {
  // The setup ran them on an empty schema (src/test/db.setup.ts).
  it('built the schema from every migration file, and a second run applies nothing', async () => {
    const files = readdirSync(new URL('../../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'))
    const { rows } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version')
    expect(rows.map((r) => r.version)).toEqual(files.sort())

    const client = await pool.connect()
    try {
      expect(await applyMigrations(client)).toEqual([])
    } finally {
      client.release()
    }
  })
})
