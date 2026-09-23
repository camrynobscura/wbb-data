/**
 * Pure parsing helpers for ESPN's career-stats shape. No network, no database —
 * just data-in / data-out, so every function here is easy to unit-test.
 */

/**
 * ESPN packs "makes" and "attempts" into one hyphenated string, e.g. "85-246"
 * = 85 made of 246 attempted. Split it into a typed pair of numbers.
 */
export function splitMakeAttempt(raw: string): {
  made: number
  attempted: number
} {
  const parts = raw.split('-')
  if (parts.length !== 2) {
    throw new Error(`Expected "made-attempted", got "${raw}"`)
  }
  const made = Number(parts[0])
  const attempted = Number(parts[1])
  return { made, attempted }
}

/**
 * ESPN aligns a category's `stats[]` values positionally to its `names[]` keys.
 * Zip them into a name→value lookup so we can read stats BY NAME instead of by
 * fragile array index (robust if ESPN ever reorders its columns).
 */
export function zipStats(
  names: string[],
  stats: string[],
): Record<string, string> {
  if (names.length !== stats.length) {
    throw new Error(
      `names (${names.length}) and stats (${stats.length}) length mismatch`,
    )
  }

  const lookup: Record<string, string> = {}
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    const value = stats[i]
    if (name !== undefined && value !== undefined) {
      lookup[name] = value
    }
  }
  return lookup
}

/** The clean, numeric box score for one season (maps to player_seasons columns). */
export interface BoxScore {
  points: number
  fgMade: number
  fgAtt: number
  fg3Made: number
  fg3Att: number
  ftMade: number
  ftAtt: number
  oreb: number
  dreb: number
  assists: number
  steals: number
  blocks: number
  turnovers: number
  fouls: number
}

/** Read one stat out of the lookup by name, failing loudly if it's absent. */
function readStat(lookup: Record<string, string>, key: string): string {
  const raw = lookup[key]
  if (raw === undefined) {
    throw new Error(`missing stat "${key}"`)
  }
  return raw
}

/**
 * Turn one season's `totals` row (its `names[]` + `stats[]`) into a numeric
 * BoxScore. Counts convert with Number(); the packed makes/attempts strings go
 * through splitMakeAttempt. We ignore ESPN's percentages and totalRebounds —
 * the database derives those itself.
 */
export function parseTotalsBox(names: string[], stats: string[]): BoxScore {
  const lookup = zipStats(names, stats)

  const fg = splitMakeAttempt(readStat(lookup, 'fieldGoalsMade-fieldGoalsAttempted'))
  const fg3 = splitMakeAttempt(
    readStat(lookup, 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'),
  )
  const ft = splitMakeAttempt(readStat(lookup, 'freeThrowsMade-freeThrowsAttempted'))

  return {
    points: Number(readStat(lookup, 'points')),
    fgMade: fg.made,
    fgAtt: fg.attempted,
    fg3Made: fg3.made,
    fg3Att: fg3.attempted,
    ftMade: ft.made,
    ftAtt: ft.attempted,
    oreb: Number(readStat(lookup, 'offensiveRebounds')),
    dreb: Number(readStat(lookup, 'defensiveRebounds')),
    assists: Number(readStat(lookup, 'assists')),
    steals: Number(readStat(lookup, 'steals')),
    blocks: Number(readStat(lookup, 'blocks')),
    turnovers: Number(readStat(lookup, 'turnovers')),
    fouls: Number(readStat(lookup, 'fouls')),
  }
}

/** The 6 miscellaneous per-season counts we keep (maps to the new columns). */
export interface MiscStats {
  doubleDoubles: number
  tripleDoubles: number
  technicalFouls: number
  flagrantFouls: number
  disqualifications: number
  ejections: number
}

/**
 * Parse the `miscellaneous` category row into the 6 counts we keep. The other 4
 * fields (assist/steal-turnover ratios, scoring/shooting efficiency) are skipped
 * — they're derivable from stats we already store. Note ESPN's keys are singular
 * (`doubleDouble`), our columns plural (`double_doubles`).
 */
export function parseMisc(names: string[], stats: string[]): MiscStats {
  const lookup = zipStats(names, stats)
  return {
    doubleDoubles: Number(readStat(lookup, 'doubleDouble')),
    tripleDoubles: Number(readStat(lookup, 'tripleDouble')),
    technicalFouls: Number(readStat(lookup, 'technicalFouls')),
    flagrantFouls: Number(readStat(lookup, 'flagrantFouls')),
    disqualifications: Number(readStat(lookup, 'disqualifications')),
    ejections: Number(readStat(lookup, 'ejections')),
  }
}

/** Games played lives in the `averages` category under key "gamesPlayed". */
export function parseGamesPlayed(names: string[], stats: string[]): number {
  return Number(readStat(zipStats(names, stats), 'gamesPlayed'))
}

// ─── Bio (core athlete endpoint) ─────────────────────────────────────────────

/**
 * Player bio (maps to the players table). `draft_*` aren't on ESPN's athlete
 * endpoints, so they stay null for v1 (backfilled later from the draft endpoint).
 */
export interface PlayerBio {
  espnId: string
  name: string
  position: string | null
  jersey: number | null
  /** ESPN's own flag — false for a retired player. Gates current-team resolution: a retired
      bio's team ref is unreliable (it can name a franchise she never played for). */
  active: boolean
  currentTeamEspnId: string | null // ESPN team id from the bio's team ref (current/last team)
  height: number | null
  weight: number | null
  birthDate: string | null // "YYYY-MM-DD"
  draftYear: number | null
  draftRound: number | null
  draftPick: number | null
  headshotUrl: string | null
}

// The slice of the core athlete response we read. Most fields are optional —
// international players may lack a college, some lack height/weight, etc.
interface EspnAthlete {
  id: string
  displayName: string
  active?: boolean
  height?: number
  weight?: number
  dateOfBirth?: string
  jersey?: string
  position?: { id?: string; abbreviation?: string }
  team?: { $ref?: string }
  headshot?: { href?: string }
  draft?: { year?: number; round?: number; selection?: number }
}

/**
 * ESPN's `positions/0` "Not Available" (abbreviation "NA") is a placeholder, not a position —
 * most players from before ~2012 carry it, on the bio and on every season row alike (measured
 * 2026-09-23: 5% of 1997's players have a real one, 100% from 2012 on). It must never be stored,
 * or "NA" becomes a position bucket of its own.
 */
function parsePosition(position: EspnAthlete['position']): string | null {
  const abbreviation = position?.abbreviation
  if (!abbreviation || abbreviation === 'NA' || position?.id === '0') return null
  return abbreviation
}

/** Parse the core athlete endpoint into our bio shape. */
export function parseBio(athlete: EspnAthlete): PlayerBio {
  return {
    espnId: athlete.id,
    // Some older names arrive with doubled spaces ("Deanna  Nolan") — collapse them, or the
    // name is ugly and its URL slug becomes "deanna--nolan".
    name: athlete.displayName.replace(/\s+/g, ' ').trim(),
    position: parsePosition(athlete.position),
    // ESPN gives jersey as a string ("22"); empty/absent → null. "00" collapses to 0.
    jersey: athlete.jersey ? Number(athlete.jersey) : null,
    // Every bio seen carries the flag (true for current players, false for retired ones); if it
    // were ever absent, assume active so the current team still resolves as it always has.
    active: athlete.active ?? true,
    // team is a $ref URL that embeds the id: ".../teams/9?..." → "9" (null if absent).
    currentTeamEspnId: athlete.team?.$ref?.match(/\/teams\/(\d+)/)?.[1] ?? null,
    height: athlete.height ?? null,
    weight: athlete.weight ?? null,
    // dateOfBirth is an ISO timestamp ("1994-08-24T07:00Z"); we store just the day.
    birthDate: athlete.dateOfBirth ? athlete.dateOfBirth.slice(0, 10) : null,
    // draft is inline when ESPN has it (2018+ draftees); older players → null.
    draftYear: athlete.draft?.year ?? null,
    draftRound: athlete.draft?.round ?? null,
    draftPick: athlete.draft?.selection ?? null, // ESPN calls the pick "selection"
    headshotUrl: athlete.headshot?.href ?? null,
  }
}

// ─── Full-season assembly + trade logic ──────────────────────────────────────

/** One parsed ESPN row before trade-grouping: a team stint OR a season TOTAL. */
export interface RawSeasonRow {
  year: number
  teamId: number | null // null = the combined multi-team TOTAL row
  gamesPlayed: number
  box: BoxScore
  misc: MiscStats
}

/** A per-team stint within a traded season (maps to player_season_stints). */
export interface StintRecord {
  teamId: number
  gamesPlayed: number
  box: BoxScore
}

/** A canonical season (maps to player_seasons) plus any stints for a trade. */
export interface SeasonRecord {
  year: number
  seasonType: number
  teamId: number | null // null when the canonical row is a multi-team TOTAL
  isTotalRow: boolean
  gamesPlayed: number
  box: BoxScore
  misc: MiscStats
  stints: StintRecord[] // empty unless the player was traded that year
}

// The slice of ESPN's /stats response we actually read.
interface EspnStatRow {
  season: { year: number }
  teamId?: number
  teamSlug?: string
  stats: string[]
}
interface EspnCategory {
  name: string
  names: string[]
  statistics: EspnStatRow[]
}
interface EspnStatsResponse {
  categories?: EspnCategory[]
  teams?: Record<string, { isAllStar?: boolean }>
}

/** Misc counts default to zero — ESPN omits the row (or whole category) when
 *  every count is zero, so "absent" means "all zero", not "unknown". */
const ZERO_MISC: MiscStats = {
  doubleDoubles: 0,
  tripleDoubles: 0,
  technicalFouls: 0,
  flagrantFouls: 0,
  disqualifications: 0,
  ejections: 0,
}

// A row's identity within one season type: (year, teamId). teamId null = TOTAL.
const rowKey = (year: number, teamId: number | null) =>
  `${year}|${teamId ?? 'total'}`

/** Build a (year, teamId) → row lookup for a category's statistics. */
function indexByRowKey(category: EspnCategory): Map<string, EspnStatRow> {
  const map = new Map<string, EspnStatRow>()
  for (const row of category.statistics) {
    map.set(rowKey(row.season.year, row.teamId ?? null), row)
  }
  return map
}

/**
 * Flatten one /stats response into raw per-row records (stints + TOTALs, not yet
 * grouped). The `totals` category drives it; averages (games played) and
 * miscellaneous are matched BY (year, teamId), not by index — misc is often a
 * subset (ESPN omits all-zero rows) or absent entirely. All-Star/exhibition rows
 * are skipped.
 */
export function extractRawRows(response: EspnStatsResponse): RawSeasonRow[] {
  const categories = response.categories ?? []
  const totals = categories.find((c) => c.name === 'totals')
  const averages = categories.find((c) => c.name === 'averages')
  // No box or no games-played source → nothing usable this season type.
  if (!totals || !averages) {
    return []
  }
  const miscCategory = categories.find((c) => c.name === 'miscellaneous')

  const teams = response.teams ?? {}
  const averagesByKey = indexByRowKey(averages)
  const miscByKey = miscCategory
    ? indexByRowKey(miscCategory)
    : new Map<string, EspnStatRow>()

  const rows: RawSeasonRow[] = []
  for (const tRow of totals.statistics) {
    // Skip All-Star / exhibition rows so they don't pollute real seasons. The
    // dict flag catches recent ones; older All-Star teams are absent from the
    // dict, so also match the slug (west / east / all-stars).
    const slug = tRow.teamSlug ?? ''
    const isAllStar =
      teams[slug]?.isAllStar === true ||
      /^(west|east)$/i.test(slug) ||
      /all[- ]?stars?/i.test(slug)
    if (isAllStar) {
      continue
    }

    const year = tRow.season.year
    const teamId = tRow.teamId ?? null
    const key = rowKey(year, teamId)

    // Games played comes from the matching averages row; skip if there isn't one.
    const avgRow = averagesByKey.get(key)
    if (!avgRow) {
      continue
    }

    const miscRow = miscByKey.get(key)

    rows.push({
      year,
      teamId,
      gamesPlayed: parseGamesPlayed(averages.names, avgRow.stats),
      box: parseTotalsBox(totals.names, tRow.stats),
      misc:
        miscRow && miscCategory
          ? parseMisc(miscCategory.names, miscRow.stats)
          : ZERO_MISC,
    })
  }
  return rows
}

/**
 * Apply the D2 trade rule: group rows by year, and for each year pick the
 * canonical season. If a no-teamId TOTAL row exists (a traded year), it's
 * canonical and the per-team rows become stints; otherwise the single team row
 * is canonical with no stints.
 */
export function groupSeasons(
  rows: RawSeasonRow[],
  seasonType: number,
): SeasonRecord[] {
  const byYear = new Map<number, RawSeasonRow[]>()
  for (const row of rows) {
    const group = byYear.get(row.year) ?? []
    group.push(row)
    byYear.set(row.year, group)
  }

  const seasons: SeasonRecord[] = []
  for (const [year, group] of byYear) {
    const totalRow = group.find((r) => r.teamId === null)
    const teamRows = group.filter((r) => r.teamId !== null)

    // Genuine multi-team season: the TOTAL row is canonical; team rows are stints.
    if (teamRows.length >= 2 && totalRow) {
      seasons.push({
        year,
        seasonType,
        teamId: null,
        isTotalRow: true,
        gamesPlayed: totalRow.gamesPlayed,
        box: totalRow.box,
        misc: totalRow.misc,
        stints: teamRows.map((r) => ({
          teamId: r.teamId as number,
          gamesPlayed: r.gamesPlayed,
          box: r.box,
        })),
      })
      continue
    }

    // Exactly one real team: that row is canonical, no stints. Any TOTAL row here
    // is spurious — e.g. an All-Star game was filtered out, leaving a lone team —
    // so we ignore it rather than trust its inflated combined stats.
    const only = teamRows[0]
    if (teamRows.length === 1 && only) {
      seasons.push({
        year,
        seasonType,
        teamId: only.teamId,
        isTotalRow: false,
        gamesPlayed: only.gamesPlayed,
        box: only.box,
        misc: only.misc,
        stints: [],
      })
      continue
    }

    // Fallback: only a TOTAL row and no team rows (unusual but usable).
    if (totalRow) {
      seasons.push({
        year,
        seasonType,
        teamId: null,
        isTotalRow: true,
        gamesPlayed: totalRow.gamesPlayed,
        box: totalRow.box,
        misc: totalRow.misc,
        stints: [],
      })
      continue
    }

    throw new Error(`year ${year}: no usable rows (${group.length})`)
  }

  return seasons
}
