import { describe, it, expect } from 'vitest'
import { countRegularSeasonGames, gameDate, lastCompletedGameDate, type ScheduleEvent } from './schedule'

/** One schedule event, shaped like ESPN's (only the fields the counter reads). */
const game = (name: string, completed: boolean, type = 2): ScheduleEvent => ({
  seasonType: { type },
  competitions: [{ status: { type: { name, completed } } }],
})
const games = (n: number, name: string, completed: boolean) =>
  Array.from({ length: n }, () => game(name, completed))

describe('countRegularSeasonGames', () => {
  it('a finished modern season: every game final → the full slate, either way', () => {
    const season2003 = games(34, 'STATUS_FINAL', true)
    expect(countRegularSeasonGames(season2003, false)).toBe(34)
    expect(countRegularSeasonGames(season2003, true)).toBe(34)
  })

  it("1998-style: ESPN's completed flag is junk, but the games were played", () => {
    // What the live 1998 schedule looks like: 1 of 30 games "completed", the rest stuck
    // on STATUS_IN_PROGRESS / STATUS_TBD a quarter-century later.
    const season1998 = [
      game('STATUS_FINAL', true),
      ...games(28, 'STATUS_IN_PROGRESS', false),
      game('STATUS_TBD', false),
    ]
    expect(countRegularSeasonGames(season1998, false)).toBe(30)
    // Read as "in progress" it would say 1 — the bug this rule exists to avoid.
    expect(countRegularSeasonGames(season1998, true)).toBe(1)
  })

  it('2020: the postponed walkout game never counts, in either mode', () => {
    const season2020 = [...games(22, 'STATUS_FINAL', true), game('STATUS_POSTPONED', false)]
    expect(countRegularSeasonGames(season2020, false)).toBe(22)
    expect(countRegularSeasonGames(season2020, true)).toBe(22)
  })

  it('the in-progress season counts only games completed so far', () => {
    const season2026 = [...games(43, 'STATUS_FINAL', true), game('STATUS_SCHEDULED', false)]
    expect(countRegularSeasonGames(season2026, true)).toBe(43)
    // Once the year is over, the same schedule reads as the full 44-game slate.
    expect(countRegularSeasonGames(season2026, false)).toBe(44)
  })

  it('ignores playoff games and events with no status', () => {
    const events = [...games(10, 'STATUS_FINAL', true), game('STATUS_FINAL', true, 3), { seasonType: { type: 2 } }]
    expect(countRegularSeasonGames(events, true)).toBe(10)
    expect(countRegularSeasonGames(events, false)).toBe(11) // no status ≠ postponed → played
  })
})

describe('gameDate', () => {
  it('is the Eastern calendar date, so a late Pacific tip-off is not a day late', () => {
    expect(gameDate('2026-09-23T23:00Z')).toBe('2026-09-23') // 7pm ET
    expect(gameDate('2026-09-24T02:00Z')).toBe('2026-09-23') // 7pm PT = 10pm ET, still the 23rd
    expect(gameDate('not a date')).toBeNull()
  })
})

describe('lastCompletedGameDate', () => {
  const at = (date: string, name: string, completed: boolean, type = 2): ScheduleEvent => ({
    date,
    seasonType: { type },
    competitions: [{ status: { type: { name, completed } } }],
  })

  it('is the latest COMPLETED regular-season game — not a scheduled, in-progress or postponed one', () => {
    const events = [
      at('2026-09-19T23:00Z', 'STATUS_FINAL', true),
      at('2026-09-21T23:00Z', 'STATUS_FINAL', true),
      at('2026-09-23T23:00Z', 'STATUS_IN_PROGRESS', false), // tipped off before the refresh
      at('2026-09-25T23:00Z', 'STATUS_SCHEDULED', false),
      at('2026-09-27T23:00Z', 'STATUS_POSTPONED', false),
    ]
    expect(lastCompletedGameDate(events)).toBe('2026-09-21')
  })

  it('ignores playoff games (they are not served) and order in the list', () => {
    const events = [
      at('2026-10-05T23:00Z', 'STATUS_FINAL', true, 3), // playoffs
      at('2026-09-19T23:00Z', 'STATUS_FINAL', true),
      at('2026-09-17T23:00Z', 'STATUS_FINAL', true),
    ]
    expect(lastCompletedGameDate(events)).toBe('2026-09-19')
  })

  it('is null before any game has been completed', () => {
    expect(lastCompletedGameDate([at('2027-05-15T23:00Z', 'STATUS_SCHEDULED', false)])).toBeNull()
    expect(lastCompletedGameDate([])).toBeNull()
  })
})
