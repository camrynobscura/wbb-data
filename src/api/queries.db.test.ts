import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchTeamGames } from '../espn/client'
import { ingestPlayer } from '../db/ingest'
import { finishScrapeRun, startScrapeRun } from '../db/scrapeRuns'
import { bio, openTestPool, resetDatabase, season, T1 } from '../test/db'
import { idOf, seedLeague, SLATES } from '../test/league'
import type { SeasonPlayed } from './contract'
import { getMeta, getPlayer, getPlayers } from './queries'

vi.mock('../espn/client', () => ({ fetchTeamGames: vi.fn(), fetchPlayedGames: vi.fn(), fetchSchedule: vi.fn() }))
vi.mocked(fetchTeamGames).mockImplementation(async (_team, year) =>
  SLATES[year] ? { games: SLATES[year], source: 'team_stats' } : null,
)

const pool = openTestPool()
afterAll(() => pool.end())

/** One season of a player in the league of src/test/league.ts. */
async function seasonOf(name: string, year: number): Promise<SeasonPlayed> {
  const player = await getPlayer(pool, await idOf(pool, name))
  const s = player?.seasons.find((x) => x.year === year)
  if (!s?.played) throw new Error(`${name} has no ${year} season`)
  return s
}

describe('getPlayer', () => {
  beforeAll(async () => {
    await resetDatabase(pool)
    await seedLeague(pool)
  })

  it("returns a player's regular seasons, a missed year filled in, the playoffs left out", async () => {
    const g1 = await getPlayer(pool, await idOf(pool, 'G1'))
    expect(g1?.seasons.map((s) => [s.year, s.played])).toEqual([
      [2017, true],
      [2018, false],
      [2019, true],
    ])
    expect(g1?.seasons[1]).toEqual({ year: 2018, played: false, reason: 'Did not play' })
    expect(g1?.seasons[2]).toMatchObject({
      age: 23, // born 1996
      gp: 20,
      teamGames: 34,
      pts: 20,
      ast: 8,
      fgp: 0.5,
      tpp: 0.3,
      fgMade: 100,
      fgAtt: 200,
      ptsTotal: 400,
    })
  })

  it('returns null for an id with no player', async () => {
    expect(await getPlayer(pool, '999999')).toBeNull()
  })

  describe('ranks among the qualified seasons', () => {
    it('ranks each counting stat by its own column, 1 = best, ties sharing a place', async () => {
      // Points a game: C1 25, G1 20, F1 18, G2 and G3 15, F2 12. Only C1 has rebounds and blocks, only G1
      // assists, only G2 steals; everyone with none shares 2nd.
      expect((await seasonOf('G1', 2019)).rank).toMatchObject({ pts: 2, reb: 2, ast: 1, stl: 2, blk: 2 })
      expect((await seasonOf('G2', 2019)).rank).toMatchObject({ pts: 4, reb: 2, ast: 2, stl: 1, blk: 2 })
      expect((await seasonOf('G3', 2019)).rank).toMatchObject({ pts: 4 })
      expect((await seasonOf('F2', 2019)).rank).toMatchObject({ pts: 6 })
      expect((await seasonOf('C1', 2019)).rank).toMatchObject({ pts: 1, reb: 1, ast: 2, stl: 2, blk: 1 })
      expect((await seasonOf('G1', 2019)).pool).toBe(18)
    })

    it("uses each player's own team's games for the games bar", async () => {
      expect((await seasonOf('G8', 2019)).rank?.pts).toBe(17) // 16 of 34 qualifies
      expect((await seasonOf('B1', 2019)).rank?.pts).toBe(8) // 15 of 33 qualifies, tied with G4 at 10 a game
      const n1 = await seasonOf('N1', 2019) // 15 of 34 doesn't
      expect([n1.rank, n1.posRank, n1.pool]).toEqual([null, null, 18])
    })

    it("gives a traded player the last team's games, never fewer than her own", async () => {
      expect((await seasonOf('TR', 2019)).teamGames).toBe(33) // 30 games; the last team played 33
      expect((await seasonOf('TR2', 2019)).teamGames).toBe(34) // 34 games; the last team played 33
    })

    it('ranks a position only in a bucket of 8 or more', async () => {
      const g1 = await seasonOf('G1', 2019)
      expect(g1.posPool).toBe(8)
      expect(g1.posRank).toMatchObject({ pts: 1, ast: 1, stl: 2, fgp: 1 })
      // Only G1 cleared the 3P% floor among the guards: no position rank for it ("1st of 1").
      expect(g1.posRank?.tpp).toBeNull()
      expect(g1.posRatePool).toMatchObject({ fgp: 8, tpp: null })
      const f1 = await seasonOf('F1', 2019) // 7 forwards
      expect([f1.posPool, f1.posRank, f1.rank?.pts]).toEqual([null, null, 3])
    })

    it('gives no position rank in a season where a qualified player has no position', async () => {
      const h8 = await seasonOf('H8', 2010) // 8 guards, and U1 with no position
      expect([h8.rank?.pts, h8.pool, h8.posPool, h8.posRank]).toEqual([1, 9, null, null])
    })
  })

  describe('shooting ranks (2018: floors at 34 games are FG% 155 attempts or 66 made, 3P% 47 or 16)', () => {
    it('ranks FG% for seasons over the floor by attempts or by makes, scaled to the team', async () => {
      const fgp = async (name: string) => (await seasonOf(name, 2018)).rank?.fgp
      expect(await fgp('S2')).toBe(1) // 66 of 150: by makes, .440
      expect(await fgp('S6')).toBe(2) // 64 of 150 on the 33-game team, whose floor is 64 made: .427
      expect(await fgp('S3')).toBe(3) // 65 of 155: by attempts, .419
      expect(await fgp('S7')).toBeNull() // 64 of 150 on the 34-game team: under both
      expect(await fgp('S1')).toBeNull() // 60 of 100
      expect(await fgp('S5')).toBeNull() // 70 of 99: over by makes, under the 100-attempt color floor
      expect((await seasonOf('S1', 2018)).ratePool).toEqual({ fgp: 3, tpp: 2, tsPct: 6 })
    })

    it('ranks 3P% the same way', async () => {
      const tpp = async (name: string) => (await seasonOf(name, 2018)).rank?.tpp
      expect(await tpp('S1')).toBe(1) // 16 of 40: by makes, .400
      expect(await tpp('S2')).toBe(2) // 15 of 47: by attempts, .319
      expect(await tpp('S3')).toBeNull() // 15 of 46
      expect(await tpp('S4')).toBeNull() // 20 of 39: over by makes, under the 40-attempt color floor
    })

    it('ranks TS% over 100 shooting possessions (FGA + 0.44 × FTA), ties sharing a place', async () => {
      const ts = async (name: string) => (await seasonOf(name, 2018)).rank?.tsPct
      // S5: 145 / (2 × 101.2) = .716, S1 .680, S2 .490, S3 .468, S6 and S7 .427
      expect(await Promise.all(['S5', 'S1', 'S2', 'S3', 'S6', 'S7'].map(ts))).toEqual([1, 2, 3, 4, 5, 5])
      expect(await ts('S4')).toBeNull() // 99 possessions
      // Under every shooting floor, still ranked in points
      expect((await seasonOf('S4', 2018)).rank).toMatchObject({ pts: 7, fgp: null, tpp: null, tsPct: null })
    })
  })
})

describe('getPlayers', () => {
  beforeAll(async () => {
    await resetDatabase(pool)
    const line = { gp: 20, pts: 200 }
    const onTeam = { currentTeamEspnId: String(T1) }
    await ingestPlayer(pool, bio('1', 'Dee', 'G', { active: false, ...onTeam }), [season(2019, T1, line)], 2026)
    await ingestPlayer(pool, bio('2', 'Cam', 'G', onTeam), [season(2023, T1, line), season(2024, T1, line, 3)], 2026)
    await ingestPlayer(pool, bio('3', 'Bea', 'F', onTeam), [season(2023, T1, line)], 2026)
    await ingestPlayer(pool, bio('4', 'Ana', 'C', onTeam), [season(2025, T1, line)], 2026)
    await pool.query(
      `INSERT INTO team_eras (team_id, name, abbreviation, start_year, end_year)
       SELECT id, 'Old Name', 'OLD', 1997, 2020 FROM teams UNION ALL SELECT id, 'New Name', 'NEW', 2021, NULL FROM teams`,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists everyone by name with ?scope=all, and the 3-season window by default', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-01T12:00:00Z') }) // window: 2024 to 2026
    expect((await getPlayers(pool, 'all')).map((p) => p.name)).toEqual(['Ana', 'Bea', 'Cam', 'Dee'])
    // Cam's only season in the window is a playoff one, which counts
    expect((await getPlayers(pool)).map((p) => p.name)).toEqual(['Ana', 'Cam'])
  })

  it('gives the current team by its current name, none for a retired player, and the regular-season span', async () => {
    const byName = new Map((await getPlayers(pool, 'all')).map((p) => [p.name, p]))
    expect(byName.get('Ana')).toMatchObject({ team: 'New Name', teamAbbr: 'NEW', active: true, firstYear: 2025 })
    expect(byName.get('Dee')).toMatchObject({ team: null, teamAbbr: null, active: false })
    expect(byName.get('Cam')).toMatchObject({ firstYear: 2023, lastYear: 2023 }) // not the 2024 playoffs
  })
})

describe('getMeta', () => {
  beforeAll(() => resetDatabase(pool))

  it('reports nothing before any run', async () => {
    expect(await getMeta(pool)).toEqual({ lastScrapedAt: null, statsThrough: null })
  })

  it('reports the last successful run, and the latest game date a successful run recorded', async () => {
    await finishScrapeRun(pool, await startScrapeRun(pool), 'success', 300, undefined, '2026-09-10')
    const second = await startScrapeRun(pool)
    await finishScrapeRun(pool, second, 'success', 300, undefined, null) // its schedule fetch failed
    await finishScrapeRun(pool, await startScrapeRun(pool), 'error', 0, 'ESPN down', '2026-09-12')
    const { rows } = await pool.query<{ finished_at: Date }>(`SELECT finished_at FROM scrape_runs WHERE id = $1`, [
      second,
    ])
    expect(await getMeta(pool)).toEqual({
      lastScrapedAt: rows[0]!.finished_at.toISOString(),
      statsThrough: '2026-09-10',
    })
  })
})
