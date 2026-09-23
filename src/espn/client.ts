import {
  parseBio,
  extractRawRows,
  groupSeasons,
  type PlayerBio,
  type SeasonRecord,
} from './parse'
import { countRegularSeasonGames, type ScheduleEvent } from './schedule'
import { FIRST_WNBA_SEASON, windowStart } from '../seasons'

// Honest, non-browser User-Agent (no personal contact info sent to ESPN).
const USER_AGENT = 'wnba-data/0.1 (personal research project)'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetch JSON politely: identify ourselves, and retry transient failures
 * (429 / 5xx / network) with a growing backoff. A 4xx that isn't 429 is a real
 * error we don't retry.
 */
async function fetchJson<T>(url: string): Promise<T> {
  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.ok) {
        return (await res.json()) as T
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`${res.status} ${res.statusText}`)
      } else {
        throw new Error(`${url} → ${res.status} ${res.statusText}`)
      }
    } catch (err) {
      lastError = err
    }
    if (attempt < maxAttempts) {
      await sleep(attempt * 1000) // 1s, then 2s
    }
  }

  throw new Error(`${url} failed after ${maxAttempts} attempts: ${String(lastError)}`)
}

// ─── Discovery (Pass A) ───────────────────────────────────────────────────────

const BYATHLETE =
  'https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/statistics/byathlete'
// 2 = regular season, 3 = playoffs — both, so a player who appeared ONLY in the playoffs
// (injured all regular season, back for the postseason) still makes the universe.
const SEASON_TYPES = [2, 3]

interface ByAthleteResponse {
  athletes?: { athlete: { id: string } }[]
}

/**
 * Every athlete who appeared in any (season, type) from `fromYear` through `toYear`,
 * deduplicated. One list per (year, type): `isqualified=false` keeps the low-minute players
 * the default would drop, and `limit=1000` is the whole list in one page (the largest season,
 * 2026, has 237). Works for every season back to 1997 (verified 2026-09-23).
 */
export async function discoverPlayerIds(fromYear: number, toYear: number): Promise<string[]> {
  const ids = new Set<string>()
  for (let year = fromYear; year <= toYear; year++) {
    for (const seasonType of SEASON_TYPES) {
      const url = `${BYATHLETE}?season=${year}&seasontype=${seasonType}&limit=1000&isqualified=false`
      const data = await fetchJson<ByAthleteResponse>(url)
      for (const entry of data.athletes ?? []) {
        ids.add(entry.athlete.id)
      }
    }
  }
  return [...ids]
}

/** D1 · the rolling-window universe: everyone in the last ROSTER_WINDOW_YEARS seasons. */
export const discoverCurrentPlayerIds = (currentYear: number): Promise<string[]> =>
  discoverPlayerIds(windowStart(currentYear), currentYear)

/** The whole league: everyone who has played since the WNBA's first season. */
export const discoverAllPlayerIds = (currentYear: number): Promise<string[]> =>
  discoverPlayerIds(FIRST_WNBA_SEASON, currentYear)

// ─── Per-player fetch (Pass B) ────────────────────────────────────────────────

const CORE_ATHLETE =
  'https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/athletes'
const statsUrl = (id: string, seasonType: number) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/${id}/stats?seasontype=${seasonType}`

/** Fetch + parse one player's bio. */
export async function fetchBio(id: string): Promise<PlayerBio> {
  const athlete = await fetchJson<Parameters<typeof parseBio>[0]>(
    `${CORE_ATHLETE}/${id}`,
  )
  return parseBio(athlete)
}

/** Fetch + parse one player's full career (regular season + playoffs). */
export async function fetchSeasons(id: string): Promise<SeasonRecord[]> {
  const [reg, post] = await Promise.all([
    fetchJson<Parameters<typeof extractRawRows>[0]>(statsUrl(id, 2)),
    fetchJson<Parameters<typeof extractRawRows>[0]>(statsUrl(id, 3)),
  ])
  return [
    ...groupSeasons(extractRawRows(reg), 2),
    ...groupSeasons(extractRawRows(post), 3),
  ]
}

// ─── Per-season totals (2nd pass: minutes + role rates) ───────────────────────

const coreSeasonUrl = (path: string) =>
  `https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/seasons/${path}`

interface CoreStatsResponse {
  splits?: { categories?: { stats?: { name: string; value: number }[] }[] }
}

/** Flatten a core statistics response's categories into one name→value lookup. */
function flattenCoreStats(response: CoreStatsResponse): Record<string, number> {
  const out: Record<string, number> = {}
  for (const category of response.splits?.categories ?? []) {
    for (const stat of category.stats ?? []) {
      out[stat.name] = stat.value
    }
  }
  return out
}

/** Fetch, returning null instead of throwing when the resource 404s / errors —
 *  e.g. a (team, year, type) that never happened. */
async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    return await fetchJson<T>(url)
  } catch {
    return null
  }
}

export interface TeamTotals {
  fga: number
  fta: number
  tov: number
  assists: number
  fgMade: number
  games: number
}

/** Team season totals for role-rate denominators (null if the team has no such season). */
export async function fetchTeamTotals(
  teamId: string,
  year: number,
  seasonType: number,
): Promise<TeamTotals | null> {
  const data = await fetchJsonOrNull<CoreStatsResponse>(
    coreSeasonUrl(`${year}/types/${seasonType}/teams/${teamId}/statistics`),
  )
  if (!data) return null
  const s = flattenCoreStats(data)
  const fga = s.fieldGoalsAttempted
  const fta = s.freeThrowsAttempted
  const tov = s.turnovers
  const assists = s.assists
  const fgMade = s.fieldGoalsMade
  const games = s.gamesPlayed
  if (
    fga === undefined || fta === undefined || tov === undefined ||
    assists === undefined || fgMade === undefined || games === undefined
  ) {
    return null
  }
  return { fga, fta, tov, assists, fgMade, games }
}

/**
 * The regular-season slate for a season, from one team's schedule — the small-sample
 * denominator. `inProgress` selects the rule (see countRegularSeasonGames in ./schedule.ts:
 * a past season counts every game that wasn't postponed or cancelled, the in-progress season
 * only the games completed so far). Null when the schedule is unavailable, so the caller can
 * fall back to max games played.
 */
export async function fetchScheduledGames(
  teamId: string,
  year: number,
  inProgress: boolean,
): Promise<number | null> {
  const data = await fetchJsonOrNull<{ events?: ScheduleEvent[] }>(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${teamId}/schedule?season=${year}`,
  )
  if (!data) return null
  return countRegularSeasonGames(data.events ?? [], inProgress) || null
}

/** Era-accurate team name + abbreviation for a specific season (null if none). */
export async function fetchTeamName(
  teamId: string,
  year: number,
): Promise<{ name: string; abbreviation: string } | null> {
  const data = await fetchJsonOrNull<{
    displayName?: string
    name?: string
    abbreviation?: string
  }>(coreSeasonUrl(`${year}/teams/${teamId}`))
  const name = data?.displayName ?? data?.name
  if (!data || !name || !data.abbreviation) return null
  return { name, abbreviation: data.abbreviation }
}

/** A player's exact total minutes for one season (null if unavailable). */
export async function fetchPlayerMinutes(
  espnId: string,
  year: number,
  seasonType: number,
): Promise<number | null> {
  const data = await fetchJsonOrNull<CoreStatsResponse>(
    coreSeasonUrl(`${year}/types/${seasonType}/athletes/${espnId}/statistics`),
  )
  if (!data) return null
  return flattenCoreStats(data).minutes ?? null
}
