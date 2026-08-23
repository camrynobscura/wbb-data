// Load .env for local dev; on a host like Render there's no file (env vars are injected
// into the environment), so a missing .env is normal — don't crash on it.
try {
  process.loadEnvFile()
} catch {
  /* no .env present — rely on real environment variables */
}
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { Pool } from 'pg'
import { getPlayer, getPlayers, getLeague } from './queries'

// Pool tuning: cap connections well under Supabase's pooler limit, and give up on a
// stuck connection or a hung query instead of leaking one forever.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000, // Postgres cancels any query running longer than 10s
})

const app = express()
const PORT = Number(process.env.PORT) || 3001

// Behind Render's proxy the client IP arrives in X-Forwarded-For; trust the first hop
// so the rate limiter keys on the real caller, not the proxy (which would be one bucket
// for everyone). '1' = trust exactly one proxy, not an open-ended chain.
app.set('trust proxy', 1)

// Safe default security headers; also drops the X-Powered-By: Express tell.
app.use(helmet())

// Only our frontend's browser origin may read this API, and only via GET.
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173', methods: ['GET'] }))

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
  const players = await getPlayers(pool)
  res.json(players)
})

app.get('/players/:id', async (req, res) => {
  const id = req.params.id
  // id is a bigint column; a non-numeric id would make Postgres throw a cast error (→ 500).
  // Treat a malformed id as "no such player" rather than a server error.
  if (!/^\d+$/.test(id)) {
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

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'internal error' })
})

app.listen(PORT, () => {
  console.log(`server is listening on ${PORT}`)
})
