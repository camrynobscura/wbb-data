import { Client } from 'pg'
import { applyMigrations } from '../db/migrate'
import { testDatabaseUrl } from './db'

/** Before the database tests: an empty schema, built by the migrations the way a new database would be. */
export default async function setup(): Promise<void> {
  const client = new Client({ connectionString: testDatabaseUrl() })
  await client.connect()
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await applyMigrations(client)
  } finally {
    await client.end()
  }
}
