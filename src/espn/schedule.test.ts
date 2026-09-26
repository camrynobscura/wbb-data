import { describe, it, expect } from 'vitest'
import { countCompletedGames, gameDate, lastCompletedGameDate, type ScheduleEvent } from './schedule'

/** One schedule event, shaped like ESPN's (only the fields the counter reads). */
const game = (name: string, completed: boolean, type = 2): ScheduleEvent => ({
  seasonType: { type },
  competitions: [{ status: { type: { name, completed } } }],
})
const games = (n: number, name: string, completed: boolean) =>
  Array.from({ length: n }, () => game(name, completed))

describe('countCompletedGames', () => {
  it('the in-progress season counts only games completed so far', () => {
    const season2026 = [...games(43, 'STATUS_FINAL', true), game('STATUS_SCHEDULED', false)]
    expect(countCompletedGames(season2026)).toBe(43)
  })

  it('a full modern season: every game final → the full slate', () => {
    expect(countCompletedGames(games(34, 'STATUS_FINAL', true))).toBe(34)
  })

  it('a postponed game never counts (the 2020 walkout game)', () => {
    const season2020 = [...games(22, 'STATUS_FINAL', true), game('STATUS_POSTPONED', false)]
    expect(countCompletedGames(season2020)).toBe(22)
  })

  it("why a finished season uses team statistics instead: 1998's completed flags are junk", () => {
    // What the live 1998 schedule looks like: 1 of 30 games "completed", the rest stuck on
    // STATUS_IN_PROGRESS / STATUS_TBD a quarter-century later. Counting these gives 1, not 30.
    const season1998 = [
      game('STATUS_FINAL', true),
      ...games(28, 'STATUS_IN_PROGRESS', false),
      game('STATUS_TBD', false),
    ]
    expect(countCompletedGames(season1998)).toBe(1)
  })

  it('ignores playoff games and events with no status', () => {
    const events = [...games(10, 'STATUS_FINAL', true), game('STATUS_FINAL', true, 3), { seasonType: { type: 2 } }]
    expect(countCompletedGames(events)).toBe(10)
  })

  it("skips the Commissioner's Cup final but counts the Cup-group games (the 2026 Aces: 45 listed, 44 played)", () => {
    const cupGroup: ScheduleEvent = {
      seasonType: { type: 2 },
      competitions: [{ status: { type: { name: 'STATUS_FINAL', completed: true } }, type: { abbreviation: 'STD' } }],
    }
    const cupFinal: ScheduleEvent = {
      seasonType: { type: 2 },
      competitions: [{ status: { type: { name: 'STATUS_FINAL', completed: true } }, type: { abbreviation: 'CC' } }],
    }
    const season2026 = [...games(37, 'STATUS_FINAL', true), ...Array.from({ length: 7 }, () => cupGroup), cupFinal]
    expect(countCompletedGames(season2026)).toBe(44)
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

  it("ignores the Commissioner's Cup final — its stats aren't in anyone's season (2026: June 30)", () => {
    const events = [
      at('2026-06-29T23:00Z', 'STATUS_FINAL', true),
      { ...at('2026-06-30T23:30Z', 'STATUS_FINAL', true), competitions: [{ status: { type: { name: 'STATUS_FINAL', completed: true } }, type: { abbreviation: 'CC' } }] },
    ]
    expect(lastCompletedGameDate(events)).toBe('2026-06-29')
  })

  it('is null before any game has been completed', () => {
    expect(lastCompletedGameDate([at('2027-05-15T23:00Z', 'STATUS_SCHEDULED', false)])).toBeNull()
    expect(lastCompletedGameDate([])).toBeNull()
  })
})
