import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { Client } from 'pg'
import { dbConfig, isSupabaseHost } from './connect'

const POOLER = 'postgresql://postgres.abcdefgh:s3cret-pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
const caFile = readFileSync(new URL('../../certs/prod-ca-2021.crt', import.meta.url), 'utf8')

/** What pg itself will use once it has merged the config with the connection string (client.js
    builds these in its constructor; no connection is opened). */
function sslPgWillUse(config: ReturnType<typeof dbConfig>): unknown {
  return (new Client(config) as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl
}

describe('dbConfig', () => {
  it('Supabase: pg ends up with Supabase root as the only trusted CA, checking on', () => {
    const ssl = sslPgWillUse(dbConfig(POOLER)) as { ca?: string; rejectUnauthorized?: boolean }
    expect(ssl.ca).toBe(caFile)
    expect(ssl.rejectUnauthorized).toBeUndefined() // Node's default: reject what doesn't verify
  })

  it.each(['sslmode=require', 'sslmode=no-verify', 'sslmode=disable', 'ssl=true', 'ssl=0', 'sslrootcert=/dev/null'])(
    'Supabase + ?%s: refuses to start, without echoing the string',
    (param) => {
      expect(() => dbConfig(`${POOLER}?${param}`)).toThrow(/own SSL settings/)
      try {
        dbConfig(`${POOLER}?${param}`)
      } catch (e) {
        expect(String(e)).not.toContain('s3cret-pw')
      }
    },
  )

  it('any other host is left to its connection string', () => {
    const local = 'postgresql://me:pw@localhost:5432/wnba?sslmode=disable'
    expect(dbConfig(local)).toEqual({ connectionString: local })
    expect(sslPgWillUse(dbConfig(local))).toBe(false)
  })

  it('refuses to run without DATABASE_URL', () => {
    expect(() => dbConfig('')).toThrow(/DATABASE_URL is not set/)
  })
})

describe('isSupabaseHost', () => {
  it('matches the poolers and direct hosts, nothing else', () => {
    expect(isSupabaseHost('aws-0-us-east-1.pooler.supabase.com')).toBe(true)
    expect(isSupabaseHost('db.abcdefgh.supabase.co')).toBe(true)
    expect(isSupabaseHost('supabase.com.evil.example')).toBe(false)
    expect(isSupabaseHost('notsupabase.com')).toBe(false)
    expect(isSupabaseHost('localhost')).toBe(false)
    expect(isSupabaseHost(null)).toBe(false)
  })
})

describe('certs/prod-ca-2021.crt', () => {
  it('is the root the live Supabase pooler presented on 2026-09-28', () => {
    const cert = new X509Certificate(caFile)
    expect(cert.subject).toContain('CN=Supabase Root 2021 CA')
    expect(cert.ca).toBe(true)
    expect(cert.fingerprint256).toBe(
      '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
    )
  })
})
