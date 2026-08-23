import type { Pool } from 'pg'
import type { PlayerBio, SeasonRecord } from '../espn/parse'
import { upsertPlayer } from './players'
import { upsertTeam } from './teams'
import { upsertSeason, upsertStint } from './seasons'

/**
 * Write one player end-to-end: the player row, then every season (and any trade
 * stints), resolving each ESPN teamId to our teams.id along the way. A per-player
 * cache means each distinct team is upserted only once.
 */
export async function ingestPlayer(
  pool: Pool,
  bio: PlayerBio,
  seasons: SeasonRecord[],
  currentSeasonYear: number,
): Promise<void> {
  const teamCache = new Map<number, string>()
  const resolveTeam = async (espnTeamId: number): Promise<string> => {
    const cached = teamCache.get(espnTeamId)
    if (cached) return cached
    const ourId = await upsertTeam(pool, String(espnTeamId))
    teamCache.set(espnTeamId, ourId)
    return ourId
  }

  // Resolve the bio's current/last team (from its ESPN id) before writing the player.
  const currentTeamId = bio.currentTeamEspnId
    ? await resolveTeam(Number(bio.currentTeamEspnId))
    : null
  const playerId = await upsertPlayer(pool, bio, currentTeamId)

  for (const season of seasons) {
    const teamId =
      season.teamId === null ? null : await resolveTeam(season.teamId)
    const isCurrent = season.year === currentSeasonYear

    const seasonId = await upsertSeason(pool, playerId, teamId, isCurrent, season)

    for (const stint of season.stints) {
      const stintTeamId = await resolveTeam(stint.teamId)
      await upsertStint(pool, seasonId, stintTeamId, stint)
    }
  }
}
