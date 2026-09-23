/**
 * How many regular-season games a team's schedule holds — the small-sample denominator
 * (league_seasons.scheduled_games). Pure, so the rule is unit-tested against real-shaped
 * fixtures (schedule.test.ts); src/espn/client.ts fetches the schedule and calls this.
 */

/** The slice of a schedule event we read. */
export interface ScheduleEvent {
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
