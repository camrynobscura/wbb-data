import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Pool } from 'pg'
import { createApp } from './app'
import type { PlayerDetail } from './contract'
import { getLeague, getMeta, getPlayer, getPlayers, getPositions } from './queries'

// The HTTP layer only: input checks, status codes, headers, CORS and the rate limit. The queries are stubbed;
// what they return from a real database is covered by the *.db.test.ts files.
vi.mock('./queries', () => ({
  getPlayers: vi.fn(),
  getPlayer: vi.fn(),
  getLeague: vi.fn(),
  getPositions: vi.fn(),
  getMeta: vi.fn(),
}))

const pool = {} as Pool // never touched: every query is stubbed
const FRONTEND = 'https://wnba-arc.netlify.app'

const wilson: PlayerDetail = {
  id: '3',
  espn: '3149391',
  name: "A'ja Wilson",
  team: 'Las Vegas Aces',
  teamAbbr: 'LV',
  pos: 'C',
  jersey: 22,
  active: true,
  firstYear: 2018,
  lastYear: 2026,
  seasons: [],
}

let server: Server | undefined
let base = ''

/** A fresh app, so each test starts with empty rate-limit counts. */
async function start(corsOrigin?: string): Promise<void> {
  const app = createApp(pool, corsOrigin)
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers })

afterEach(async () => {
  server?.closeAllConnections()
  await new Promise((resolve) => server?.close(resolve))
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('GET /players', () => {
  it('lists the rolling window by default and everyone on record with ?scope=all', async () => {
    await start()
    vi.mocked(getPlayers).mockResolvedValue([wilson])
    const byDefault = await get('/players')
    expect(byDefault.status).toBe(200)
    expect(await byDefault.json()).toEqual([wilson])
    expect(getPlayers).toHaveBeenLastCalledWith(pool, 'current')
    await get('/players?scope=all')
    expect(getPlayers).toHaveBeenLastCalledWith(pool, 'all')
  })

  it.each(['?scope=bogus', '?scope=', '?scope=all&scope=current'])(
    'answers %s with a 400, without querying',
    async (q) => {
      await start()
      const res = await get('/players' + q)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "scope must be 'current' or 'all'" })
      expect(getPlayers).not.toHaveBeenCalled()
    },
  )
})

describe('GET /players/:id', () => {
  it('answers a player on record with its JSON', async () => {
    await start()
    vi.mocked(getPlayer).mockResolvedValue(wilson)
    const res = await get('/players/3')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(wilson)
    expect(getPlayer).toHaveBeenCalledWith(pool, '3')
  })

  it('answers 404 for an id with no player', async () => {
    await start()
    vi.mocked(getPlayer).mockResolvedValue(null)
    const res = await get('/players/99999999999')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'player not found' })
  })

  // Postgres would throw on these (not a bigint), which would be a 500.
  it.each(['abc', '12a', '-1', '9223372036854775808'])('answers 404 for "%s", without querying', async (id) => {
    await start()
    const res = await get('/players/' + id)
    expect(res.status).toBe(404)
    expect(getPlayer).not.toHaveBeenCalled()
  })

  it('answers a malformed %-escape with a 400, not logged as a crash', async () => {
    await start()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('/players/%ZZ')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad request' })
    expect(logged).not.toHaveBeenCalled()
  })
})

describe('GET /meta', () => {
  it("answers the query's result", async () => {
    await start()
    const meta = { lastScrapedAt: '2026-09-29T11:24:05.000Z', statsThrough: '2026-09-11' }
    vi.mocked(getMeta).mockResolvedValue(meta)
    expect(await (await get('/meta')).json()).toEqual(meta)
  })
})

describe('a failed query', () => {
  it.each([
    ['/league', getLeague],
    ['/positions', getPositions],
    ['/meta', getMeta],
    ['/players', getPlayers],
    ['/players/3', getPlayer],
  ] as const)('%s answers 500 without the error text, and logs the error', async (path, query) => {
    await start()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('connection to db.example.supabase.co failed')
    vi.mocked(query).mockRejectedValue(err)
    const res = await get(path)
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('{"error":"internal error"}')
    expect(logged).toHaveBeenCalledWith(err)
  })
})

describe('security headers', () => {
  it("sends helmet's headers and no X-Powered-By", async () => {
    await start()
    const res = await get('/')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-powered-by')).toBeNull()
  })
})

describe('CORS', () => {
  const allowed = async (origin: string) =>
    (await get('/', { Origin: origin })).headers.get('access-control-allow-origin')

  // A fixed origin is sent to every caller (cors/lib/index.js), and a browser on any other origin refuses it.
  it('with CORS_ORIGIN set, names only that origin, whoever asks', async () => {
    await start(FRONTEND)
    for (const origin of [FRONTEND, FRONTEND + '.evil.example', 'http://localhost:5173']) {
      expect(await allowed(origin)).toBe(FRONTEND)
    }
  })

  it('with CORS_ORIGIN unset (local dev), lets any localhost or 127.0.0.1 port read over http', async () => {
    await start()
    for (const origin of ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:4173']) {
      expect(await allowed(origin)).toBe(origin)
    }
    for (const origin of ['https://localhost:5173', 'http://localhost', 'http://localhost.evil.example:80', FRONTEND]) {
      expect(await allowed(origin)).toBeNull()
    }
  })

  it('offers only GET to a preflight', async () => {
    await start(FRONTEND)
    const res = await fetch(base + '/players', {
      method: 'OPTIONS',
      headers: { Origin: FRONTEND, 'Access-Control-Request-Method': 'DELETE' },
    })
    expect(res.headers.get('access-control-allow-methods')).toBe('GET')
  })
})

describe('rate limit', () => {
  const burst = (n: number, headers?: Record<string, string>) =>
    Promise.all(Array.from({ length: n }, () => get('/', headers).then((r) => r.status)))

  it('answers the 101st request in a minute from one address with a 429', async () => {
    await start()
    expect(new Set(await burst(100))).toEqual(new Set([200]))
    const res = await get('/')
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'too many requests, please slow down' })
    expect(res.headers.get('ratelimit-limit')).toBe('100')
  })

  // Render's proxy appends the caller's address to X-Forwarded-For; only that last entry is trusted.
  it("counts each caller behind the proxy separately, by the proxy's entry only", async () => {
    await start()
    const caller = { 'X-Forwarded-For': '203.0.113.1' }
    expect(new Set(await burst(100, caller))).toEqual(new Set([200]))
    expect((await get('/', caller)).status).toBe(429)
    // A made-up address put in front by the caller doesn't start a new count.
    expect((await get('/', { 'X-Forwarded-For': '198.51.100.9, 203.0.113.1' })).status).toBe(429)
    expect((await get('/', { 'X-Forwarded-For': '203.0.113.2' })).status).toBe(200)
  })
})
