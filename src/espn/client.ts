import {
  parseBio,
  extractRawRows,
  groupSeasons,
  parseCoreSeasonBox,
  missingAppearances,
  isAllStarTeam,
  type Appearance,
  type PlayerBio,
  type SeasonRecord,
} from './parse'
import { countRegularSeasonGames, lastCompletedGameDate, type ScheduleEvent } from './schedule'
import { FIRST_WNBA_SEASON, windowStart } from '../seasons'

// Honest, non-browser User-Agent (no personal contact info sent to ESPN).
const USER_AGENT = 'wnba-data/0.1 (personal research project)'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetch JSON politely: identify ourselves, and retry transient failures (429 / 5xx /
 * network / an unparseable body) with a growing backoff. Any other 4xx is a real answer,
 * not something to retry — and with `notFoundIsNull` a 404 comes back as null: ESPN saying
 * "nothing here" (a 2000s reserve with no career stats page), which is data, not an error.
 * (Before 2026-09-23 a 4xx fell into the retry loop: three identical 404s per player.)
 */
async function request<T>(url: string, notFoundIsNull: boolean): Promise<T | null> {
  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response | null = null
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.ok) {
        return (await res.json()) as T
      }
    } catch (err) {
      lastError = err // network error, or a 200 whose body wouldn't parse — retry
    }
    if (res && !res.ok) {
      if (res.status === 404 && notFoundIsNull) return null
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`${url} → ${res.status} ${res.statusText}`)
      }
      lastError = new Error(`${res.status} ${res.statusText}`)
    }
    if (attempt < maxAttempts) {
      await sleep(attempt * 1000) // 1s, then 2s
    }
  }

  throw new Error(`${url} failed after ${maxAttempts} attempts: ${String(lastError)}`)
}

const fetchJson = <T>(url: string): Promise<T> => request<T>(url, false) as Promise<T>
const fetchJsonOrNotFound = <T>(url: string): Promise<T | null> => request<T>(url, true)

// ─── Discovery (Pass A) ───────────────────────────────────────────────────────

const BYATHLETE =
  'https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/statistics/byathlete'
// 2 = regular season, 3 = playoffs — both, so a player who appeared ONLY in the playoffs
// (injured all regular season, back for the postseason) still makes the universe.
const SEASON_TYPES = [2, 3]

interface ByAthleteResponse {
  categories?: { name: string; names: string[] }[]
  athletes?: {
    athlete: { id: string }
    categories?: { name: string; values: (number | null)[] }[]
  }[]
}

/** Each athlete's appearances, keyed by ESPN id. */
export type Appearances = Map<string, Appearance[]>

/**
 * Every (season, type) each athlete appeared in from `fromYear` through `toYear`, with her
 * games played. One list per (year, type): `isqualified=false` keeps the low-minute players
 * the default would drop, and `limit=1000` is the whole list in one page (the largest season,
 * 2026, has 237). Works for every season back to 1997 (verified 2026-09-23). The lists are the
 * record of who played; the per-player /stats endpoint is only the first place the box is
 * looked for (see recoverSeasons).
 */
export async function discoverAppearances(fromYear: number, toYear: number): Promise<Appearances> {
  const appearances: Appearances = new Map()
  for (let year = fromYear; year <= toYear; year++) {
    for (const seasonType of SEASON_TYPES) {
      const url = `${BYATHLETE}?season=${year}&seasontype=${seasonType}&limit=1000&isqualified=false`
      const data = await fetchJson<ByAthleteResponse>(url)
      // Games played sits in the `general` category, positionally under its `names`.
      const gpIndex =
        data.categories?.find((c) => c.name === 'general')?.names.indexOf('gamesPlayed') ?? -1
      for (const entry of data.athletes ?? []) {
        const values = entry.categories?.find((c) => c.name === 'general')?.values
        const gamesPlayed = gpIndex >= 0 ? Number(values?.[gpIndex] ?? 0) : 0
        const list = appearances.get(entry.athlete.id) ?? []
        list.push({ year, seasonType, gamesPlayed })
        appearances.set(entry.athlete.id, list)
      }
    }
  }
  return appearances
}

/** D1 · the rolling-window universe: everyone in the last ROSTER_WINDOW_YEARS seasons. */
export const discoverCurrentAppearances = (currentYear: number): Promise<Appearances> =>
  discoverAppearances(windowStart(currentYear), currentYear)

/** The whole league: everyone who has played since the WNBA's first season. */
export const discoverAllAppearances = (currentYear: number): Promise<Appearances> =>
  discoverAppearances(FIRST_WNBA_SEASON, currentYear)

/** Just the ids, for a dry run. */
export async function discoverPlayerIds(fromYear: number, toYear: number): Promise<string[]> {
  return [...(await discoverAppearances(fromYear, toYear)).keys()]
}

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

/**
 * Fetch + parse one player's full career (regular season + playoffs). A 404 on a season
 * type is ESPN having no stats page for it — a few 2000s reserves (Charel Allen, Laura
 * Harper, Whitney Boddie) have none at all — so that type contributes no seasons; the
 * caller decides what a player with no seasons means.
 */
export async function fetchSeasons(id: string): Promise<SeasonRecord[]> {
  type StatsResponse = Parameters<typeof extractRawRows>[0]
  const [reg, post] = await Promise.all([
    fetchJsonOrNotFound<StatsResponse>(statsUrl(id, 2)),
    fetchJsonOrNotFound<StatsResponse>(statsUrl(id, 3)),
  ])
  return [
    ...(reg ? groupSeasons(extractRawRows(reg), 2) : []),
    ...(post ? groupSeasons(extractRawRows(post), 3) : []),
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

/**
 * "Stats through …": the latest completed regular-season game date across the given teams'
 * schedules (each team's schedule has that team's off days, so one team isn't enough). Null when
 * no schedule could be fetched or nothing has been completed. A failed team schedule is skipped,
 * not fatal — this feeds a footer line, never the data.
 */
export async function fetchLastGameDate(teamIds: string[], year: number): Promise<string | null> {
  let latest: string | null = null
  for (const teamId of teamIds) {
    const data = await fetchJsonOrNull<{ events?: ScheduleEvent[] }>(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${teamId}/schedule?season=${year}`,
    )
    const d = data ? lastCompletedGameDate(data.events ?? []) : null
    if (d && (latest == null || d > latest)) latest = d
  }
  return latest
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

/** One team as ESPN lists it TODAY (site API, all current franchises in one call). */
export interface CurrentTeam {
  espnId: string
  name: string
  abbreviation: string
}

/**
 * The league's current teams — id, display name, abbreviation — from ESPN's teams list (one
 * request, ~15 rows). The nightly compares these against the OPEN team_eras rows to notice a
 * rename or relocation the day ESPN makes it (2026-09-25): ESPN keeps the franchise id across a
 * move (San Antonio Stars → Las Vegas Aces stayed 17), so the only visible change is the name,
 * and nothing else in the pipeline reads it. Null when the request fails — the caller treats
 * that as "couldn't check", never as "no teams".
 */
export async function fetchCurrentTeams(): Promise<CurrentTeam[] | null> {
  const data = await fetchJsonOrNull<{
    sports?: { leagues?: { teams?: { team?: { id?: string; displayName?: string; abbreviation?: string } }[] }[] }[]
  }>('https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams')
  const entries = data?.sports?.[0]?.leagues?.[0]?.teams
  if (!entries) return null
  const teams: CurrentTeam[] = []
  for (const e of entries) {
    const t = e.team
    if (t?.id && t.displayName && t.abbreviation) {
      teams.push({ espnId: t.id, name: t.displayName, abbreviation: t.abbreviation })
    }
  }
  return teams
}

// ─── Seasons /stats doesn't have (the fallback) ───────────────────────────────

interface EventLogResponse {
  teams?: Record<string, { id: string }>
}

/** Is (team, year) a real franchise? An athlete's event log also lists the All-Star side she
 *  played for (2026's flagged "TEAM SPOON", 2007's unflagged "WEST", id 99). Cached: only a
 *  handful of distinct (team, year) pairs ever come up. */
const realTeamCache = new Map<string, boolean>()
async function isRealTeam(teamId: string, year: number): Promise<boolean> {
  const key = `${year}|${teamId}`
  if (!realTeamCache.has(key)) {
    const data = await fetchJsonOrNull<Parameters<typeof isAllStarTeam>[0]>(
      coreSeasonUrl(`${year}/teams/${teamId}`),
    )
    realTeamCache.set(key, data !== null && !isAllStarTeam(data))
  }
  return realTeamCache.get(key)!
}

/**
 * One season the career /stats endpoint didn't return, rebuilt from the core per-season
 * endpoint (the exact box — see parseCoreSeasonBox for which seasons this happens to) and
 * the season's event log (the team she played for; /stats' team is not on the core response,
 * and the season-scoped athlete record names her LAST team, not that year's). One real team →
 * a normal single-team season. More than one → a traded season with no stint detail, stored
 * as a TOTAL row (logged, so it can be looked at). Null when there's no box or no team.
 */
export async function fetchSeasonFromCore(
  espnId: string,
  year: number,
  seasonType: number,
): Promise<SeasonRecord | null> {
  const stats = await fetchJsonOrNull<CoreStatsResponse>(
    coreSeasonUrl(`${year}/types/${seasonType}/athletes/${espnId}/statistics`),
  )
  if (!stats) return null
  const parsed = parseCoreSeasonBox(flattenCoreStats(stats))
  if (!parsed) return null

  const log = await fetchJsonOrNull<EventLogResponse>(
    coreSeasonUrl(`${year}/athletes/${espnId}/eventlog?limit=1`),
  )
  const teamIds: string[] = []
  for (const id of Object.keys(log?.teams ?? {})) {
    if (await isRealTeam(id, year)) teamIds.push(id)
  }
  if (teamIds.length === 0) return null
  if (teamIds.length > 1) {
    console.warn(
      `  ${espnId} ${year}/${seasonType}: recovered season spans teams ${teamIds.join(',')} — stored as a total without stints`,
    )
  }
  return {
    year,
    seasonType,
    teamId: teamIds.length === 1 ? Number(teamIds[0]) : null,
    isTotalRow: teamIds.length !== 1,
    ...parsed,
    stints: [],
  }
}

/**
 * The seasons a player's appearances say she played that /stats didn't return, recovered
 * from the core endpoint. Returns only the recovered records; the caller appends them.
 */
export async function recoverSeasons(
  espnId: string,
  fromStats: SeasonRecord[],
  appearances: Appearance[],
): Promise<SeasonRecord[]> {
  const recovered: SeasonRecord[] = []
  for (const a of missingAppearances(fromStats, appearances)) {
    const season = await fetchSeasonFromCore(espnId, a.year, a.seasonType)
    if (season) recovered.push(season)
  }
  return recovered
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
