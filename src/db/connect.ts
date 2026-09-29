import { readFileSync } from 'node:fs'
import type { ClientConfig } from 'pg'
import { parse } from 'pg-connection-string'

/**
 * The one place every connection to the database is configured — the API and every script.
 *
 * Supabase: always encrypted, and the server must prove it's Supabase. Its certificates are signed
 * by Supabase's own root, "Supabase Root 2021 CA" (certs/prod-ca-2021.crt, from the dashboard's SSL
 * Configuration; the same root the live session pooler presented on 2026-09-28; it expires
 * 2031-04-26), which isn't among the public roots Node trusts — so `ssl: true` alone fails with
 * "self-signed certificate in certificate chain". Handing pg that root as `ca` checks the chain,
 * and pg passes the host as `servername`, so Node checks the hostname too. Without it, pg would send the
 * password and every query unencrypted: it only encrypts when told to.
 *
 * A Supabase connection string may not carry its own SSL settings (`sslmode`, `ssl`,
 * `sslrootcert`, …): pg lets the string's settings REPLACE the `ssl` given here
 * (pg/lib/connection-parameters.js), so `?sslmode=no-verify` would silently switch the check off
 * and `?sslmode=require` would drop the certificate and fail. Refusing to start says so plainly.
 *
 * Any other host (a local Postgres, say) is left to its connection string, the usual way.
 */
export function dbConfig(connectionString = process.env.DATABASE_URL): ClientConfig {
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  // pg's own parser (pg-connection-string), so "the host" and "has SSL settings" mean exactly
  // what pg will read from the string.
  const parsed = parse(connectionString)
  if (!isSupabaseHost(parsed.host)) return { connectionString }
  if (parsed.ssl !== undefined) {
    throw new Error(
      'DATABASE_URL has its own SSL settings (sslmode, ssl, sslrootcert, …). Remove them: for ' +
        'Supabase the certificate check is set in src/db/connect.ts, and pg would let the ' +
        "string's settings replace it.",
    )
  }
  return { connectionString, ssl: { ca: supabaseRootCa() } }
}

/** Supabase's hosts: the poolers (`*.pooler.supabase.com`) and direct database hosts. */
export function isSupabaseHost(host: string | null): boolean {
  return host != null && /(^|\.)supabase\.(com|co)$/i.test(host)
}

let rootCa: string | undefined

/** Read once, on the first Supabase connection — a non-Supabase setup never needs the file. */
function supabaseRootCa(): string {
  rootCa ??= readFileSync(new URL('../../certs/prod-ca-2021.crt', import.meta.url), 'utf8')
  return rootCa
}
