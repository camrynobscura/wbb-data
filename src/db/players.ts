import type { Pool } from 'pg'
import type { PlayerBio } from '../espn/parse'
import { KNOWN_FORMER_NAMES, nextFormerNames } from './formerNames'
import { storedPosition } from './positionOverrides'
import { upsertReturningId } from './upsert'

/**
 * Insert or update a player by espn_id, returning our surrogate id (as a string —
 * a Postgres bigint exceeds JS's safe integer range). Idempotent: the daily
 * scrape refreshes the bio in place instead of duplicating. draft_* are filled
 * when ESPN has them (2018+ draftees), null otherwise. When ESPN's name differs from the stored
 * one, the stored name is kept in former_names and reported as `renamedFrom`.
 */
export async function upsertPlayer(
  pool: Pool,
  bio: PlayerBio,
  currentTeamId: string | null,
): Promise<{ id: string; renamedFrom: string | null }> {
  const before = (
    await pool.query<{ name: string; former_names: string[] }>(
      `SELECT name, former_names FROM players WHERE espn_id = $1`,
      [bio.espnId],
    )
  ).rows[0]
  const id = await upsertReturningId(pool, 'players', ['espn_id'], {
    espn_id: bio.espnId,
    name: bio.name,
    position: storedPosition(bio),
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
  const stored = before?.former_names ?? []
  const former = nextFormerNames(stored, before?.name ?? null, bio.name, KNOWN_FORMER_NAMES[bio.espnId])
  if (former.length !== stored.length || former.some((n, i) => n !== stored[i])) {
    await pool.query(`UPDATE players SET former_names = $2 WHERE id = $1`, [id, former])
  }
  return { id, renamedFrom: before && before.name !== bio.name ? before.name : null }
}
