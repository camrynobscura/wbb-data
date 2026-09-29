import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSchedule, fetchTeamGames } from '../espn/client'
import type { ScheduleEvent } from '../espn/schedule'
import { computeLeague } from './computeLeague'
import { ingestPlayer } from './ingest'
import { seasonTeams } from './teams'
import { fillFinishedTeamGames, refreshCurrentTeamGames } from './teamGames'
import { bio, openTestPool, resetDatabase, season, setTeamGames, T1, T2 } from '../test/db'

vi.mock('../espn/client', () => ({ fetchTeamGames: vi.fn(), fetchPlayedGames: vi.fn(), fetchSchedule: vi.fn() }))

const pool = openTestPool()
afterAll(() => pool.end())

const T3 = 20
const rows = async () =>
  (
    await pool.query(
      `SELECT t.espn_id, g.season_year, g.games, g.source FROM team_season_games g JOIN teams t ON t.id = g.team_id
       ORDER BY 1, 2`,
    )
  ).rows

beforeEach(async () => {
  vi.resetAllMocks()
  await resetDatabase(pool)
  for (const [i, team] of [T1, T2, T3].entries()) {
    await ingestPlayer(pool, bio(String(i), `P${i}`, 'G'), [season(2019, team, { gp: 20, pts: 200 })], 2026)
  }
})

describe('fillFinishedTeamGames', () => {
  it("takes ESPN's team statistics, else the season total; with neither, reports the team as missing", async () => {
    const espn: Record<string, { games: number; source: 'team_stats' | 'correction' }> = {
      [`${T1}|2019`]: { games: 34, source: 'team_stats' },
      [`${T2}|2019`]: { games: 32, source: 'correction' },
    }
    vi.mocked(fetchTeamGames).mockImplementation(async (team, year) => espn[`${team}|${year}`] ?? null)
    await computeLeague(pool) // the season total, 34 (team 6's)
    const teams = await seasonTeams(pool, 2019)
    const noSeason = { ...teams[0]!, year: 2020 } // no league row that year to fall back on
    const out = await fillFinishedTeamGames(pool, [...teams, noSeason])
    expect(await rows()).toEqual([
      { espn_id: String(T2), season_year: 2019, games: 32, source: 'correction' },
      { espn_id: String(T3), season_year: 2019, games: 34, source: 'season_total' },
      { espn_id: String(T1), season_year: 2019, games: 34, source: 'team_stats' },
    ])
    expect(out.missing).toEqual([noSeason])
  })
})

describe('refreshCurrentTeamGames', () => {
  const game = (date: string): ScheduleEvent => ({
    date,
    seasonType: { type: 2 },
    competitions: [{ status: { type: { name: 'STATUS_FINAL', completed: true } }, type: { abbreviation: 'STD' } }],
  })

  it("counts each team's played games, keeps a row when its schedule fails, and finds the latest game", async () => {
    await setTeamGames(pool, [[T2, 2019, 5]]) // yesterday's count
    vi.mocked(fetchSchedule).mockImplementation(
      async (team) =>
        team === String(T1)
          ? [game('2019-06-01T23:00Z'), game('2019-06-04T02:00Z')] // the second: 10 PM Eastern on June 3
          : team === String(T2)
            ? null // the fetch failed
            : [], // nothing played yet: no row
    )
    const out = await refreshCurrentTeamGames(pool, await seasonTeams(pool, 2019))
    expect(await rows()).toEqual([
      { espn_id: String(T2), season_year: 2019, games: 5, source: 'team_stats' },
      { espn_id: String(T1), season_year: 2019, games: 2, source: 'schedule' },
    ])
    expect(out).toEqual({ written: 1, failed: [String(T2)], lastGameDate: '2019-06-03' })
  })
})
