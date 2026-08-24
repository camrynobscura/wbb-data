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
