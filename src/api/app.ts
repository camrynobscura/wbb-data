import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import type { Pool } from 'pg'
import { getPlayer, getPlayers, getLeague, getPositions, getMeta } from './queries'
import { isPlayerId } from './playerId'

/**
 * The API's routes and middleware. No database connection or port of its own: server.ts passes the real
 * pool and listens, and the tests pass a stand-in. `corsOrigin` is the CORS_ORIGIN setting.
 */
export function createApp(pool: Pool, corsOrigin: string | undefined): Express {
  const app = express()

  // Behind Render's proxy the client IP arrives in X-Forwarded-For; trust the first hop
  // so the rate limiter keys on the real caller, not the proxy (which would be one bucket
  // for everyone). '1' = trust exactly one proxy, not an open-ended chain.
  app.set('trust proxy', 1)

  // Safe default security headers; also drops the X-Powered-By: Express tell.
  app.use(helmet())

  // Only our frontend's browser origin may read this API, and only via GET. In prod CORS_ORIGIN
  // is set (the Netlify URL) and stays an exact match. When it's UNSET — local dev — accept any
  // localhost port rather than one hard-coded one: Vite silently takes the next free port when
  // 5173 is busy, and an exact-5173 default then CORS-blocks every request, which surfaces in the
  // app as a baffling "data not found". Dev-only, GET-only, localhost-only. 127.0.0.1 is included
  // because a browser treats it as a different origin from localhost.
  app.use(cors({ origin: corsOrigin ?? /^http:\/\/(localhost|127\.0\.0\.1):\d+$/, methods: ['GET'] }))

  // Abuse guard: an open, unauthenticated API on a free DB tier shouldn't be hammerable.
  // 100/min/IP is far above real use (the SPA makes a handful of calls per visit).
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'too many requests, please slow down' },
    }),
  )

  app.get('/', (req, res) => {
    res.send({ ok: true })
  })

  app.get('/players', async (req, res) => {
    // ?scope=current (the default: the rolling window) | all (every player on record, retired included).
    // Anything else is the client's mistake, not a silent default.
    const scope = req.query.scope ?? 'current'
    if (scope !== 'current' && scope !== 'all') {
      res.status(400).json({ error: "scope must be 'current' or 'all'" })
      return
    }
    const players = await getPlayers(pool, scope)
    res.json(players)
  })

  app.get('/players/:id', async (req, res) => {
    const id = req.params.id
    // id is a bigint column; a non-numeric or out-of-range id would make Postgres throw (→ 500).
    // Treat a malformed id as "no such player" rather than a server error.
    if (!isPlayerId(id)) {
      res.status(404).json({ error: 'player not found' })
      return
    }
    const player = await getPlayer(pool, id)
    if (!player) {
      res.status(404).json({ error: 'player not found' })
      return
    }
    res.json(player)
  })

  app.get('/league', async (req, res) => {
    const league = await getLeague(pool)
    res.json(league)
  })

  app.get('/positions', async (req, res) => {
    const positions = await getPositions(pool)
    res.json(positions)
  })

  app.get('/meta', async (req, res) => {
    const meta = await getMeta(pool)
    res.json(meta)
  })

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // Express marks the client's own mistakes with a 4xx status — e.g. 400 for a malformed
    // %-escape in the path (`/players/%ZZ`). Answer those as such, without logging them as crashes.
    const status = (err as { status?: unknown } | null)?.status
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ error: 'bad request' })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'internal error' })
  })

  return app
}
