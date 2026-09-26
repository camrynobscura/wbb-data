import type { Pool } from 'pg'
import { fetchSchedule, fetchTeamGames } from '../espn/client'
import { countPlayedGames, lastCompletedGameDate } from '../espn/schedule'
import type { SeasonTeam } from './teams'

// team_season_games (migration 008): how many regular-season games each team played in a season —
// the Y in its players' "of Y games" and the slate their games bars scale by. Read through the
// player_season_team_games view by computeLeague, computePositions, the API's rank query and
// GET /players/:id. Two ways in, one per kind of season (measured on all 380 team-seasons,
// 2026-09-26 — DATA-NOTES "A finished season's games come from team statistics"):

type Source = 'team_stats' | 'correction' | 'season_total' | 'schedule'

async function upsert(pool: Pool, team: SeasonTeam, games: number, source: Source): Promise<void> {
  await pool.query(
    `INSERT INTO team_season_games (team_id, season_year, games, source) VALUES ($1, $2, $3, $4)
     ON CONFLICT (team_id, season_year) DO UPDATE SET games = EXCLUDED.games, source = EXCLUDED.source`,
    [team.teamId, team.year, games, source],
  )
}

export interface FinishedFill {
  /** Rows written, by where the number came from. */
  bySource: Partial<Record<Source, number>>
  /** Team-seasons left without a row: no team statistics AND no season total to fall back on. */
  missing: SeasonTeam[]
}

/**
 * FINISHED seasons: ESPN team statistics gamesPlayed, a hand-checked correction winning over it
 * (fetchTeamGames); where ESPN has no statistics (the Comets 2007–08, the Monarchs 2007–09), the
 * season total, league_seasons.scheduled_games — right for each of those five: a player on each
 * team logged the full season total. Needs league_seasons for the fallback, so on a full rebuild
 * run compute-league first (then again after this, since its pools read these rows).
 */
export async function fillFinishedTeamGames(pool: Pool, teams: SeasonTeam[]): Promise<FinishedFill> {
  const totals = new Map(
    (await pool.query<{ season_year: number; scheduled_games: number }>(
      `SELECT season_year, scheduled_games FROM league_seasons`,
    )).rows.map((r) => [r.season_year, r.scheduled_games]),
  )
  const out: FinishedFill = { bySource: {}, missing: [] }
  for (const team of teams) {
    const fetched = await fetchTeamGames(team.espnId, team.year)
    const total = totals.get(team.year)
    const [games, source]: [number, Source] | [undefined, undefined] = fetched
      ? [fetched.games, fetched.source]
      : total != null
        ? [total, 'season_total']
        : [undefined, undefined]
    if (games == null || source == null) {
      out.missing.push(team)
      continue
    }
    await upsert(pool, team, games, source)
    out.bySource[source] = (out.bySource[source] ?? 0) + 1
  }
  return out
}

export interface CurrentRefresh {
  written: number
  /** ESPN ids whose schedule couldn't be fetched — their rows keep the last night's count. */
  failed: string[]
  /** "Stats through …": the latest played regular-season game across every team's schedule. */
  lastGameDate: string | null
}

/**
 * The season IN PROGRESS, nightly: each team's schedule — the games it has played so far
 * (countPlayedGames: completed, not the Cup final, not a forfeit, a duplicate once). The same
 * download gives "Stats through" (lastCompletedGameDate, max over teams — one team's schedule has
 * its off days). A failed schedule keeps the team's previous row (a day stale at worst) rather than
 * dropping it; a team with nothing played yet gets no row (its players fall back to the season
 * total). Must run BEFORE computeLeague / computePositions, whose pools read these rows.
 */
export async function refreshCurrentTeamGames(pool: Pool, teams: SeasonTeam[]): Promise<CurrentRefresh> {
  const out: CurrentRefresh = { written: 0, failed: [], lastGameDate: null }
  for (const team of teams) {
    const events = await fetchSchedule(team.espnId, team.year)
    if (events == null) {
      out.failed.push(team.espnId)
      continue
    }
    const played = countPlayedGames(events)
    if (played > 0) {
      await upsert(pool, team, played, 'schedule')
      out.written++
    }
    const d = lastCompletedGameDate(events)
    if (d && (out.lastGameDate == null || d > out.lastGameDate)) out.lastGameDate = d
  }
  return out
}
