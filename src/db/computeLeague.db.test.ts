import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchTeamGames } from '../espn/client'
import { getLeague, getPositions } from '../api/queries'
import { computeLeague } from './computeLeague'
import { computePositions } from './computePositions'
import { openTestPool, resetDatabase } from '../test/db'
import { idOf, seedLeague, SLATES } from '../test/league'

vi.mock('../espn/client', () => ({ fetchTeamGames: vi.fn(), fetchPlayedGames: vi.fn(), fetchSchedule: vi.fn() }))
vi.mocked(fetchTeamGames).mockImplementation(async (_team, year) =>
  SLATES[year] ? { games: SLATES[year], source: 'team_stats' } : null,
)

const pool = openTestPool()
afterAll(() => pool.end())

// The league is in src/test/league.ts; every player there has the per-game numbers used below.
describe('league averages', () => {
  beforeAll(async () => {
    await resetDatabase(pool)
    await seedLeague(pool)
  })

  it('counts the qualified player-seasons, and those with a position', async () => {
    const { rows } = await pool.query(
      `SELECT season_year, scheduled_games, qualified_players, qualified_with_position FROM league_seasons ORDER BY 1`,
    )
    expect(rows).toEqual([
      { season_year: 2010, scheduled_games: 34, qualified_players: 9, qualified_with_position: 8 }, // U1 has none
      { season_year: 2017, scheduled_games: 34, qualified_players: 1, qualified_with_position: 1 },
      { season_year: 2018, scheduled_games: 34, qualified_players: 7, qualified_with_position: 7 },
      // 8 guards (not N1), 7 forwards (B1 at 15 of 33 in), 3 centers (both traded players in)
      { season_year: 2019, scheduled_games: 34, qualified_players: 18, qualified_with_position: 18 },
    ])
  })

  it("averages each qualified player's per-game numbers: not N1's 30, not G1's playoffs", async () => {
    const y2019 = (await getLeague(pool)).find((s) => s.year === 2019)!
    // Points a game: 25 + 20 + 18 + 15 + 15 + 12 + 11 + 10 + 10 + 9 + 8 + 7.5 + 7 + 6.5 + 6 + 5 + 4 + 3 = 192; / 18
    expect(y2019.pts).toBe(10.667)
    // One player each: C1's 15 rebounds and 3 blocks, G1's 8 assists, G2's 2 steals; / 18
    expect([y2019.reb, y2019.ast, y2019.stl, y2019.blk]).toEqual([0.833, 0.444, 0.111, 0.167])
  })

  it("pools shooting from the season's totals, not a mean of each player's percentage", async () => {
    const y2019 = (await getLeague(pool)).find((s) => s.year === 2019)!
    // Guards 580 of 1,600, the other seven forwards and both traded centers 40 of 100 each (360 of 900), C1
    // 10 of 10: 950 / 2,510 = .378. A mean of the 18 percentages would be .417.
    expect(y2019.fgp).toBe(0.378)
  })

  it('stores the spread and the deciles of each counting stat', async () => {
    const y2019 = (await getLeague(pool)).find((s) => s.year === 2019)!
    expect(y2019.stdev?.pts).toBe(5.747) // population standard deviation of the 18 values above
    // From 3 (F6) to 25 (C1), the middle two of 18 (9 and 10) giving 9.5, interpolated like percentile_cont
    expect(y2019.pctiles?.pts).toEqual([3, 4.7, 6.2, 7.05, 7.9, 9.5, 10.2, 11.9, 15, 18.6, 25])
  })

  it('writes a position average only for a bucket of 8 or more, and only in a season where everyone has a position', async () => {
    // 2019: guards 8 (a bucket), forwards 7, centers 3. 2018: 7 forwards. 2010: 8 guards, but U1 has no position.
    const positions = await getPositions(pool)
    expect(positions.map((p) => [p.year, p.position, p.qualifiedPlayers])).toEqual([[2019, 'G', 8]])
    expect(positions[0]!.pts).toBe(10.375) // 20 + 15 + 15 + 10 + 8 + 6 + 5 + 4 = 83; / 8
  })
})

describe('recomputing a season', () => {
  beforeAll(async () => {
    await resetDatabase(pool)
    await seedLeague(pool)
  })

  it('drops a position bucket that falls under 8', async () => {
    // G8 down to 10 of 34 games: no longer qualified, so 7 guards.
    await pool.query(`UPDATE player_seasons SET games_played = 10 WHERE player_id = $1`, [await idOf(pool, 'G8')])
    await computeLeague(pool, { year: 2019 })
    await computePositions(pool, { year: 2019 })
    expect(await getPositions(pool)).toEqual([])
    const y2019 = (await getLeague(pool)).find((s) => s.year === 2019)!
    expect(y2019.pts).toBe(11.059) // 192 - 4 = 188; / 17
  })
})
