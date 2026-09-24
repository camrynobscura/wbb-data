/**
 * How many regular-season games a team's schedule holds — the small-sample denominator
 * (league_seasons.scheduled_games). Pure, so the rule is unit-tested against real-shaped
 * fixtures (schedule.test.ts); src/espn/client.ts fetches the schedule and calls this.
 */

/** The slice of a schedule event we read. */
export interface ScheduleEvent {
  /** Tip-off, ISO 8601 UTC ("2026-09-23T23:00Z"). */
  date?: string
  seasonType?: { type?: number }
  competitions?: { status?: { type?: { name?: string; completed?: boolean } } }[]
}

const REGULAR_SEASON = 2

/** A game that was never played. The 2020 walkout game (LA, 2020-08-27) is STATUS_POSTPONED. */
const NEVER_PLAYED = new Set(['STATUS_POSTPONED', 'STATUS_CANCELED'])

/**
 * - A PAST season: every regular-season game that wasn't postponed or cancelled. Not
 *   "completed": ESPN's completed flag is unreliable before 2002 (1997: 0 of 28 games flagged;
 *   1998: 1 of 30; 1999–2001: 2 each — measured 2026-09-23), and a slate of 1 or 2 would let a
 *   one-game player "qualify" for the league averages. A postponed-and-never-replayed game must
 *   still not count (LA 2020 = 22 played, not 23 scheduled) — and that one IS flagged.
 * - The IN-PROGRESS season: the games completed so far, so the small-sample gate scales with
 *   how much of the season has actually happened (D6.1: a regular isn't flagged small-sample
 *   just because the season is young).
 */
/** A tip-off instant as the calendar date where the league plays, "YYYY-MM-DD". ESPN gives UTC;
    a 7pm Pacific tip is 02:00Z the next day, so the UTC date would be a day late for late games.
    Eastern is the WNBA's home zone (every team is in the US), so an Eastern date is the game's
    date as fans and box scores know it. */
export function gameDate(iso: string): string | null {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  return t.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) // en-CA → YYYY-MM-DD
}

/**
 * "Stats through …": the date of the latest COMPLETED regular-season game in a schedule, or
 * null if none has been completed. Completed only — a game that tipped off before a refresh but
 * hadn't finished isn't in the stats either. The caller takes the max across teams: one team's
 * schedule has that team's off days.
 */
export function lastCompletedGameDate(events: ScheduleEvent[]): string | null {
  let latest: string | null = null
  for (const event of events) {
    if (event.seasonType?.type !== REGULAR_SEASON) continue
    if (event.competitions?.[0]?.status?.type?.completed !== true) continue
    const d = event.date ? gameDate(event.date) : null
    if (d && (latest == null || d > latest)) latest = d
  }
  return latest
}

export function countRegularSeasonGames(events: ScheduleEvent[], inProgress: boolean): number {
  let played = 0
  for (const event of events) {
    if (event.seasonType?.type !== REGULAR_SEASON) continue
    const status = event.competitions?.[0]?.status?.type
    const counts = inProgress ? status?.completed === true : !NEVER_PLAYED.has(status?.name ?? '')
    if (counts) played++
  }
  return played
}
