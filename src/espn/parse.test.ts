import { describe, it, expect } from 'vitest'
import {
  splitMakeAttempt,
  parseTotalsBox,
  parseMisc,
  groupSeasons,
  parseBio,
  extractRawRows,
} from './parse'
import type { BoxScore, MiscStats, RawSeasonRow } from './parse'

describe('splitMakeAttempt', () => {
  it('splits a "made-attempted" string into numbers', () => {
    expect(splitMakeAttempt('85-246')).toEqual({ made: 85, attempted: 246 })
  })

  it('handles an all-zero line', () => {
    expect(splitMakeAttempt('0-0')).toEqual({ made: 0, attempted: 0 })
  })

  it('throws on a malformed value (no hyphen)', () => {
    expect(() => splitMakeAttempt('85')).toThrow()
  })
})

describe('parseTotalsBox', () => {
  const names = [
    'points',
    'offensiveRebounds',
    'defensiveRebounds',
    'totalRebounds',
    'assists',
    'steals',
    'blocks',
    'turnovers',
    'fieldGoalsMade-fieldGoalsAttempted',
    'fieldGoalPct',
    'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
    'threePointFieldGoalPct',
    'freeThrowsMade-freeThrowsAttempted',
    'freeThrowPct',
    'fouls',
  ]

  const stats = [
    '265',
    '12',
    '47',
    '59',
    '106',
    '16',
    '4',
    '79',
    '85-246',
    '34.6',
    '35-96',
    '36.5',
    '60-69',
    '87.0',
    '57',
  ]

  it('parses a season totals row into a numeric box score', () => {
    expect(parseTotalsBox(names, stats)).toEqual({
      points: 265,
      fgMade: 85,
      fgAtt: 246,
      fg3Made: 35,
      fg3Att: 96,
      ftMade: 60,
      ftAtt: 69,
      oreb: 12,
      dreb: 47,
      assists: 106,
      steals: 16,
      blocks: 4,
      turnovers: 79,
      fouls: 57,
    })
  })
})

describe('parseMisc', () => {
  const names = [
    'doubleDouble',
    'tripleDouble',
    'assistTurnoverRatio',
    'stealTurnoverRatio',
    'scoringEfficiency',
    'shootingEfficiency',
    'technicalFouls',
    'flagrantFouls',
    'disqualifications',
    'ejections',
  ]

  const stats = ['0', '0', '1.3', '0.2', '1.077', '0.42', '0', '0', '2', '0']

  it('keeps the 6 count stats and ignores the 4 derivable ones', () => {
    expect(parseMisc(names, stats)).toEqual({
      doubleDoubles: 0,
      tripleDoubles: 0,
      technicalFouls: 0,
      flagrantFouls: 0,
      disqualifications: 2,
      ejections: 0,
    })
  })
})

describe('groupSeasons', () => {
  // Tiny factories so the fixtures stay short — only the fields a test checks matter.
  const box = (points: number): BoxScore => ({
    points,
    fgMade: 0, fgAtt: 0, fg3Made: 0, fg3Att: 0, ftMade: 0, ftAtt: 0,
    oreb: 0, dreb: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0,
  })
  const misc = (): MiscStats => ({
    doubleDoubles: 0, tripleDoubles: 0, technicalFouls: 0,
    flagrantFouls: 0, disqualifications: 0, ejections: 0,
  })

  it('single-team season → one record, no stints', () => {
    const rows: RawSeasonRow[] = [
      { year: 2023, teamId: 17, gamesPlayed: 40, box: box(500), misc: misc() },
    ]
    const result = groupSeasons(rows, 2)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      year: 2023,
      seasonType: 2,
      teamId: 17,
      isTotalRow: false,
      stints: [],
    })
  })

  it('traded season → TOTAL is canonical, team rows become stints', () => {
    const rows: RawSeasonRow[] = [
      { year: 2026, teamId: 6, gamesPlayed: 12, box: box(200), misc: misc() },
      { year: 2026, teamId: 11, gamesPlayed: 4, box: box(60), misc: misc() },
      { year: 2026, teamId: null, gamesPlayed: 16, box: box(260), misc: misc() },
    ]
    const result = groupSeasons(rows, 2)

    expect(result).toHaveLength(1)
    const season = result[0]!
    expect(season.isTotalRow).toBe(true)
    expect(season.teamId).toBeNull()
    expect(season.gamesPlayed).toBe(16) // 12 + 4, from the TOTAL row
    expect(season.box.points).toBe(260) // combined, from the TOTAL row
    expect(season.stints).toHaveLength(2)
    expect(season.stints.map((s) => s.teamId)).toEqual([6, 11])
  })

  it('ignores a spurious TOTAL when only one real team remains (All-Star filtered)', () => {
    const rows: RawSeasonRow[] = [
      { year: 2007, teamId: 11, gamesPlayed: 34, box: box(600), misc: misc() },
      { year: 2007, teamId: null, gamesPlayed: 35, box: box(613), misc: misc() }, // polluted TOTAL
    ]
    const result = groupSeasons(rows, 2)

    expect(result).toHaveLength(1)
    const season = result[0]!
    expect(season.isTotalRow).toBe(false)
    expect(season.teamId).toBe(11)
    expect(season.box.points).toBe(600) // real team row, not the inflated 613
    expect(season.stints).toEqual([])
  })
})

describe('extractRawRows', () => {
  // Minimal category builders. totals needs all 15 keys parseTotalsBox reads;
  // averages needs only gamesPlayed; misc needs the 6 kept keys.
  const TOTALS_NAMES = [
    'points', 'offensiveRebounds', 'defensiveRebounds', 'totalRebounds',
    'assists', 'steals', 'blocks', 'turnovers',
    'fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalPct',
    'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointFieldGoalPct',
    'freeThrowsMade-freeThrowsAttempted', 'freeThrowPct', 'fouls',
  ]
  const AVG_NAMES = ['gamesPlayed']
  const MISC_NAMES = [
    'doubleDouble', 'tripleDouble', 'technicalFouls',
    'flagrantFouls', 'disqualifications', 'ejections',
  ]

  const row = (year: number, teamId: number | null, stats: string[], teamSlug?: string) => ({
    season: { year },
    ...(teamId === null ? {} : { teamId }),
    ...(teamSlug ? { teamSlug } : {}),
    stats,
  })
  const totalsRow = (year: number, teamId: number | null, points: number, slug?: string) =>
    row(year, teamId, [String(points), '0', '0', '0', '0', '0', '0', '0', '0-0', '0', '0-0', '0', '0-0', '0', '0'], slug)
  const avgRow = (year: number, teamId: number | null, gp: number, slug?: string) =>
    row(year, teamId, [String(gp)], slug)
  const miscRow = (year: number, teamId: number | null, dd: number) =>
    row(year, teamId, [String(dd), '0', '0', '0', '0', '0'])
  const cat = (name: string, names: string[], statistics: ReturnType<typeof row>[]) => ({ name, names, statistics })

  it('matches misc by (year, teamId) and defaults a missing misc row to zero', () => {
    const response = {
      categories: [
        cat('totals', TOTALS_NAMES, [totalsRow(2022, 3, 100), totalsRow(2023, 3, 200)]),
        cat('averages', AVG_NAMES, [avgRow(2022, 3, 30), avgRow(2023, 3, 32)]),
        // misc has ONLY 2022 — 2023 was all-zero so ESPN omitted it
        cat('miscellaneous', MISC_NAMES, [miscRow(2022, 3, 5)]),
      ],
    }
    const rows = extractRawRows(response)
    expect(rows).toHaveLength(2)
    const y2022 = rows.find((r) => r.year === 2022)!
    const y2023 = rows.find((r) => r.year === 2023)!
    expect(y2022.misc.doubleDoubles).toBe(5)
    expect(y2023.misc.doubleDoubles).toBe(0) // defaulted, not misaligned
    expect(y2023.gamesPlayed).toBe(32)
  })

  it('returns [] when the totals category is missing', () => {
    const response = { categories: [cat('averages', AVG_NAMES, [avgRow(2022, 3, 30)])] }
    expect(extractRawRows(response)).toEqual([])
  })

  it('skips All-Star rows', () => {
    const response = {
      categories: [
        cat('totals', TOTALS_NAMES, [totalsRow(2024, 3, 100, 'dallas'), totalsRow(2024, 999, 50, 'all-stars')]),
        cat('averages', AVG_NAMES, [avgRow(2024, 3, 30, 'dallas'), avgRow(2024, 999, 1, 'all-stars')]),
      ],
      teams: { 'all-stars': { isAllStar: true }, dallas: { isAllStar: false } },
    }
    const rows = extractRawRows(response)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.teamId).toBe(3)
  })
})

describe('parseBio', () => {
  it('maps a full athlete to bio fields', () => {
    expect(
      parseBio({
        id: '3065570',
        displayName: 'Kelsey Plum',
        height: 68,
        weight: 145,
        dateOfBirth: '1994-08-24T07:00Z',
        jersey: '10',
        position: { abbreviation: 'G' },
        team: { $ref: 'http://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/seasons/2024/teams/17?lang=en' },
        headshot: { href: 'https://a.espncdn.com/i/headshots/wnba/players/full/3065570.png' },
        draft: { year: 2017, round: 1, selection: 1 },
      }),
    ).toEqual({
      espnId: '3065570',
      name: 'Kelsey Plum',
      position: 'G',
      jersey: 10,
      currentTeamEspnId: '17',
      height: 68,
      weight: 145,
      birthDate: '1994-08-24',
      draftYear: 2017,
      draftRound: 1,
      draftPick: 1,
      headshotUrl: 'https://a.espncdn.com/i/headshots/wnba/players/full/3065570.png',
    })
  })

  it('nulls out missing optional fields (e.g. no college)', () => {
    expect(parseBio({ id: '999', displayName: 'Rookie Intl' })).toEqual({
      espnId: '999',
      name: 'Rookie Intl',
      position: null,
      jersey: null,
      currentTeamEspnId: null,
      height: null,
      weight: null,
      birthDate: null,
      draftYear: null,
      draftRound: null,
      draftPick: null,
      headshotUrl: null,
    })
  })
})
