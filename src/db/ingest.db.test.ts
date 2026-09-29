import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ingestPlayer } from './ingest'
import { bio, openTestPool, resetDatabase, season, T1, T2, tradedSeason } from '../test/db'

const pool = openTestPool()
afterAll(() => pool.end())
beforeEach(() => resetDatabase(pool))

const count = async (table: string) => Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n)
const teamOf = async (espnId: string) =>
  (
    await pool.query<{ espn_id: string | null }>(
      `SELECT t.espn_id FROM players p LEFT JOIN teams t ON t.id = p.current_team_id WHERE p.espn_id = $1`,
      [espnId],
    )
  ).rows[0]?.espn_id

describe('ingestPlayer', () => {
  it("writes a traded season as a total row plus one stint per team, in ESPN's order", async () => {
    await ingestPlayer(
      pool,
      bio('1', 'Traded', 'G'),
      [
        tradedSeason(2019, { gp: 30, pts: 300 }, [
          [T1, 16],
          [T2, 14],
        ]),
      ],
      2026,
    )
    const { rows } = await pool.query(
      `SELECT ps.team_id, ps.is_total_row, t.espn_id AS stint_team, st.games_played
       FROM player_seasons ps JOIN player_season_stints st ON st.season_id = ps.id JOIN teams t ON t.id = st.team_id
       ORDER BY st.id`,
    )
    expect(rows).toEqual([
      { team_id: null, is_total_row: true, stint_team: String(T1), games_played: 16 },
      { team_id: null, is_total_row: true, stint_team: String(T2), games_played: 14 },
    ])
  })

  it('updates in place when the same player is ingested again', async () => {
    await ingestPlayer(pool, bio('1', 'Player', 'G'), [season(2019, T1, { gp: 10, pts: 100 })], 2026)
    await ingestPlayer(pool, bio('1', 'Player Renamed', 'F'), [season(2019, T1, { gp: 12, pts: 130 })], 2026)
    expect([await count('players'), await count('player_seasons'), await count('teams')]).toEqual([1, 1, 1])
    const { rows } = await pool.query(
      `SELECT p.name, p.position, ps.games_played, ps.points FROM players p JOIN player_seasons ps ON ps.player_id = p.id`,
    )
    expect(rows).toEqual([{ name: 'Player Renamed', position: 'F', games_played: 12, points: 130 }])
  })

  it("takes an active player's current team from the bio, but only a team already on record", async () => {
    const played = [season(2019, T1, { gp: 10, pts: 100 })]
    await ingestPlayer(pool, bio('1', 'Active', 'G', { currentTeamEspnId: String(T1) }), played, 2026)
    // ESPN sometimes names a departed player's national team: no such WNBA team, so none, and no team made.
    await ingestPlayer(pool, bio('2', 'Abroad', 'G', { currentTeamEspnId: '999' }), played, 2026)
    // A retired player's bio can name a franchise she never played for.
    await ingestPlayer(pool, bio('3', 'Retired', 'G', { active: false, currentTeamEspnId: String(T1) }), played, 2026)
    expect([await teamOf('1'), await teamOf('2'), await teamOf('3')]).toEqual([String(T1), null, null])
    expect(await count('teams')).toBe(1)
  })
})
