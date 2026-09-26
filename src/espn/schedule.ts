/**
 * Reading a team's schedule: how many regular-season games are completed so far (the
 * in-progress season's small-sample denominator, league_seasons.scheduled_games) and the date of
 * the latest one ("Stats through …"). Pure, so the rules are unit-tested against real-shaped
 * fixtures (schedule.test.ts); src/espn/client.ts fetches the schedule and calls these.
 */

/** The slice of a schedule event we read. */
export interface ScheduleEvent {
  /** Tip-off, ISO 8601 UTC ("2026-09-23T23:00Z"). */
  date?: string
  seasonType?: { type?: number }
  competitions?: {
    status?: { type?: { name?: string; completed?: boolean } }
    /** The game's kind: "STD" for an ordinary game, "CC" for the Commissioner's Cup final. */
    type?: { abbreviation?: string }
  }[]
}

const REGULAR_SEASON = 2

/**
 * A game that counts toward the regular season: listed as regular season (type 2) and not the
 * Commissioner's Cup final. ESPN files the Cup final under the regular season, but it doesn't count
 * in the standings or in any player's season stats — ESPN's team statistics leave it out (measured
 * 2026-09-26: both finalists show one extra schedule game every year 2021–2026, e.g. the 2024
 * Liberty and Lynx 41 vs 40, and the 2026 Aces and Liberty 45 vs 44). Its competition type is
 * "CC" (id 39, "WNBA Commissioner's Cup Championship"); the ordinary Cup-group games are "STD" and
 * count like any other.
 */
function isRegularSeasonGame(event: ScheduleEvent): boolean {
  return event.seasonType?.type === REGULAR_SEASON && event.competitions?.[0]?.type?.abbreviation !== 'CC'
}

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
 * hadn't finished isn't in the stats either, and neither is the Commissioner's Cup final
 * (isRegularSeasonGame), so a night with only the final doesn't move the date. The caller takes
 * the max across teams: one team's schedule has that team's off days.
 */
export function lastCompletedGameDate(events: ScheduleEvent[]): string | null {
  let latest: string | null = null
  for (const event of events) {
    if (!isRegularSeasonGame(event)) continue
    if (event.competitions?.[0]?.status?.type?.completed !== true) continue
    const d = event.date ? gameDate(event.date) : null
    if (d && (latest == null || d > latest)) latest = d
  }
  return latest
}

/**
 * The regular-season games completed so far — the IN-PROGRESS season's slate, so the
 * small-sample gate scales with how much of the season has actually happened (D6.1: a regular
 * isn't flagged small-sample just because the season is young). A postponed game isn't
 * completed, so it never counts (the 2020 walkout game, LA 2020-08-27, is STATUS_POSTPONED);
 * neither does the Commissioner's Cup final (isRegularSeasonGame).
 *
 * Only for the current season. A FINISHED season's slate comes from ESPN's team statistics
 * instead (fetchTeamGamesPlayed in ./client.ts), because old schedules can't be counted:
 * the completed flag is junk before 2002 (1997: 0 of 28 games flagged; 1998: 1 of 30;
 * 1999–2001: 2 each — measured 2026-09-23), and the 2001 Sparks schedule lists a game that
 * was never played (event 210611004, June 11 at Houston: STATUS_TBD, 0–0, no box score —
 * found 2026-09-26), so counting every game gave 33 for a 32-game season.
 */
export function countCompletedGames(events: ScheduleEvent[]): number {
  let completed = 0
  for (const event of events) {
    if (!isRegularSeasonGame(event)) continue
    if (event.competitions?.[0]?.status?.type?.completed === true) completed++
  }
  return completed
}
