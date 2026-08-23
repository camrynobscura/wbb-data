process.loadEnvFile()
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { Pool } from 'pg'
import { getPlayer, getPlayers, getLeague } from './queries'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const app = express()
const PORT = 3001

// Only our frontend's browser origin may read this API, and only via GET.
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173', methods: ['GET'] }))

app.get('/', (req, res) => {
  res.send({ ok: true })
})

app.get('/players', async (req, res) => {
  const players = await getPlayers(pool)
  res.json(players)
})

app.get('/players/:id', async (req, res) => {
  const id = req.params.id
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
  res.status(500).json({ error: 'internal error'})
})

app.listen(PORT, () => {
  console.log('server is listening')
})
