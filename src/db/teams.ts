import type { Pool } from 'pg'
import { upsertReturningId } from './upsert'

/**
 * Insert or update a team by its ESPN id, returning our surrogate id. The teams
 * table is pure franchise identity (names live in team_eras); we just need the
 * row to exist so player_seasons.team_id has something to reference.
 */
export async function upsertTeam(pool: Pool, espnTeamId: string): Promise<string> {
  return upsertReturningId(pool, 'teams', ['espn_id'], { espn_id: espnTeamId })
}

/**
 * Look up a team's surrogate id by ESPN id WITHOUT creating it. Returns null if we
 * have no such team. Used to resolve a bio's "current team" ref: teams are only
 * ever created from real game data (seasons/stints), so a bio pointing at a
 * non-WNBA team (ESPN sometimes lists a departed player's NATIONAL team) finds
 * nothing here and the player's current_team_id is left null — no junk row created.
 */
export async function getTeamIdByEspn(
  pool: Pool,
  espnTeamId: string,
): Promise<string | null> {
  const res = await pool.query(`SELECT id FROM teams WHERE espn_id = $1`, [
    espnTeamId,
  ])
  return res.rows.length ? (res.rows[0] as { id: string }).id : null
}

/**
 * ESPN's ids (teams.espn_id) for every team with a regular-season row in a year: the season's team,
 * plus each stint's team for traded players (stints hang off the season row — they carry no year
 * themselves). ESPN's ids, NOT our surrogate teams.id: until 2026-09-26 the nightly's "Stats
 * through" step sent teams.id to ESPN's schedule endpoint, which reached only 7 of the 15 2026
 * teams (our 17 is the Mystics, ESPN's 17 the Aces; our 26 is a 400) — the date was right only
 * because one of those 7 played on the last game day.
 */
export async function seasonTeamEspnIds(pool: Pool, year: number): Promise<string[]> {
  const { rows } = await pool.query<{ espn_id: string }>(
    `SELECT DISTINCT t.espn_id FROM player_seasons ps
       JOIN teams t ON t.id = ps.team_id
      WHERE ps.season_year = $1 AND ps.season_type = 2
     UNION
     SELECT DISTINCT t.espn_id FROM player_season_stints st
       JOIN player_seasons ps ON ps.id = st.season_id
       JOIN teams t ON t.id = st.team_id
      WHERE ps.season_year = $1 AND ps.season_type = 2`,
    [year],
  )
  return rows.map((r) => r.espn_id)
}
