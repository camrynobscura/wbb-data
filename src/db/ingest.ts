import type { Pool } from 'pg'
import type { PlayerBio, SeasonRecord } from '../espn/parse'
import { upsertPlayer } from './players'
import { upsertTeam, getTeamIdByEspn } from './teams'
import { upsertSeason, upsertStint } from './seasons'

/**
 * Write one player end-to-end: the player row, then every season (and any trade
 * stints), resolving each ESPN teamId to our teams.id along the way. A per-player
 * cache means each distinct team is upserted only once. Returns the name the player had before,
 * when ESPN's differs from the stored one — the caller's cue to report a rename.
 */
export async function ingestPlayer(
  pool: Pool,
  bio: PlayerBio,
  seasons: SeasonRecord[],
  currentSeasonYear: number,
): Promise<{ renamedFrom: string | null }> {
  const teamCache = new Map<number, string>()
  // Create a team row ONLY from real game data — a season/stint team id is always a
  // real WNBA franchise the player actually played for.
  const resolveTeam = async (espnTeamId: number): Promise<string> => {
    const cached = teamCache.get(espnTeamId)
    if (cached) return cached
    const ourId = await upsertTeam(pool, String(espnTeamId))
    teamCache.set(espnTeamId, ourId)
    return ourId
  }

  // Write the player first (the FK target for seasons). current_team_id is set
  // below by lookup, once real team rows exist — never created from the bio.
  const { id: playerId, renamedFrom } = await upsertPlayer(pool, bio, null)

  for (const season of seasons) {
    const teamId = season.teamId === null ? null : await resolveTeam(season.teamId)
    const isCurrent = season.year === currentSeasonYear

    const seasonId = await upsertSeason(pool, playerId, teamId, isCurrent, season)

    for (const stint of season.stints) {
      const stintTeamId = await resolveTeam(stint.teamId)
      await upsertStint(pool, seasonId, stintTeamId, stint)
    }
  }

  // Set the current team from the bio by LOOKUP only — never create a team from it
  // (see getTeamIdByEspn) — and only for an ACTIVE player: a retired bio's team ref is
  // unreliable (Deanna Nolan's names a franchise she never played for), and a retired
  // player has no current team anyway, so hers stays null. For an active player, ESPN
  // sometimes points a departed player's bio at her NATIONAL team; that resolves to
  // nothing, so current_team_id stays null (as upsertPlayer(..., null) already set it).
  // Done after the season loop so the player's own team already exists on a
  // from-scratch build.
  if (bio.active && bio.currentTeamEspnId) {
    const currentTeamId = await getTeamIdByEspn(pool, bio.currentTeamEspnId)
    if (currentTeamId) {
      await pool.query(`UPDATE players SET current_team_id = $2, updated_at = now() WHERE id = $1`, [
        playerId,
        currentTeamId,
      ])
    }
  }
  return { renamedFrom }
}
