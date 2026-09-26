/**
 * Reading a team's schedule for the season in progress: how many regular-season games the team
 * has played so far (its team_season_games row, the Y in its players' "of Y games") and the date
 * of the latest one ("Stats through …"). Pure, so the rules are unit-tested against real-shaped
 * fixtures (schedule.test.ts); src/espn/client.ts fetches the schedule, src/db/teamGames.ts and
 * computeLeague.ts call these.
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
    competitors?: { team?: { id?: string } }[]
  }[]
}

const REGULAR_SEASON = 2

/**
 * A regular-season game that was actually PLAYED — the only kind whose stats are in anyone's
 * season. ESPN lists three things under the regular season that weren't (all measured on every
 * team-season 1997–2026, 2026-09-26):
 * - the Commissioner's Cup final: competition type "CC" (id 39, "WNBA Commissioner's Cup
 *   Championship"). It counts in no standings and no player's season — both finalists showed one
 *   extra schedule game every year 2021–2026 (e.g. the 2026 Aces and Liberty 45 vs 44). The
 *   ordinary Cup-group games are "STD" and count like any other.
 * - a forfeit: STATUS_FORFEIT, flagged completed, 0–0 (the 2018 Aces at Washington, Aug 3 —
 *   both teams played 33 of 34).
 * - a postponed game: not completed, so the completed check already drops it (the 2020 walkout
 *   game, LA 2020-08-27, is STATUS_POSTPONED).
 * (A game can also be listed twice — see countPlayedGames.)
 */
function isPlayedGame(event: ScheduleEvent): boolean {
  const competition = event.competitions?.[0]
  const status = competition?.status?.type
  return (
    event.seasonType?.type === REGULAR_SEASON &&
    competition?.type?.abbreviation !== 'CC' &&
    status?.completed === true &&
    status.name !== 'STATUS_FORFEIT'
  )
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
 * "Stats through …": the date of the latest PLAYED regular-season game in a schedule
 * (isPlayedGame), or null if none has been played. Completed only — a game that tipped off before
 * a refresh but hadn't finished isn't in the stats either — and not the Cup final or a forfeit,
 * whose stats are in nobody's season, so a night with only one of those doesn't move the date.
 * The caller takes the max across teams: one team's schedule has that team's off days.
 */
export function lastCompletedGameDate(events: ScheduleEvent[]): string | null {
  let latest: string | null = null
  for (const event of events) {
    if (!isPlayedGame(event)) continue
    const d = event.date ? gameDate(event.date) : null
    if (d && (latest == null || d > latest)) latest = d
  }
  return latest
}

/**
 * The regular-season games a team has played so far — for the IN-PROGRESS season, its
 * team_season_games row (and the Sparks' count is the league's season total). So the small-sample
 * gate scales with how much of the season has actually happened (D6.1: a regular isn't flagged
 * small-sample just because the season is young). Played = isPlayedGame; a game ESPN lists twice
 * (2011: the June 4 Fever–Sky game under two event ids) counts once — the same date and the same
 * two teams is one game (the WNBA plays no same-day doubleheaders).
 *
 * Only for the current season. A FINISHED season's count comes from ESPN's team statistics
 * instead (fetchTeamGames in ./client.ts), because old schedules can't be counted: the completed
 * flag is junk before 2002 (1997: 0 of 28 games flagged; 1998: 1 of 30; 1999–2001: 2 each —
 * measured 2026-09-23), and the 2001 Sparks schedule lists a game that was never played (event
 * 210611004, June 11 at Houston: STATUS_TBD, 0–0, no box score), so counting it gave 33 for a
 * 32-game season.
 */
export function countPlayedGames(events: ScheduleEvent[]): number {
  const seen = new Set<string>()
  let played = 0
  for (const event of events) {
    if (!isPlayedGame(event)) continue
    const day = event.date ? gameDate(event.date) : null
    const teams = (event.competitions?.[0]?.competitors ?? []).map((c) => c.team?.id).filter((id) => id != null)
    // Without a date and both teams we can't tell a duplicate apart — count it.
    if (day == null || teams.length !== 2) {
      played++
      continue
    }
    const key = `${day}|${teams.sort().join('-')}`
    if (seen.has(key)) continue
    seen.add(key)
    played++
  }
  return played
}
