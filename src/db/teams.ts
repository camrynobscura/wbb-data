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
