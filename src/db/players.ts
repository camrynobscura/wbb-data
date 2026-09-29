import type { Pool } from 'pg'
import type { PlayerBio } from '../espn/parse'
import { upsertReturningId } from './upsert'

/**
 * Insert or update a player by espn_id, returning our surrogate id (as a string —
 * a Postgres bigint exceeds JS's safe integer range). Idempotent: the daily
 * scrape refreshes the bio in place instead of duplicating. draft_* are filled
 * when ESPN has them (2018+ draftees), null otherwise.
 */
export async function upsertPlayer(
  pool: Pool,
  bio: PlayerBio,
  currentTeamId: string | null,
): Promise<string> {
  return upsertReturningId(pool, 'players', ['espn_id'], {
    espn_id: bio.espnId,
    name: bio.name,
    position: bio.position,
    jersey: bio.jersey,
    active: bio.active,
    current_team_id: currentTeamId,
    height: bio.height,
    weight: bio.weight,
    birth_date: bio.birthDate,
    draft_year: bio.draftYear,
    draft_round: bio.draftRound,
    draft_pick: bio.draftPick,
    headshot_url: bio.headshotUrl,
  })
}
