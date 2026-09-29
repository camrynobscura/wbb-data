import { describe, it, expect } from 'vitest'
import {
  splitMakeAttempt,
  parseTotalsBox,
  parseMisc,
  groupSeasons,
  parseBio,
  parseCoreSeasonBox,
  missingAppearances,
  isAllStarTeam,
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
    fgMade: 0,
    fgAtt: 0,
    fg3Made: 0,
    fg3Att: 0,
    ftMade: 0,
    ftAtt: 0,
    oreb: 0,
    dreb: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  })
  const misc = (): MiscStats => ({
    doubleDoubles: 0,
    tripleDoubles: 0,
    technicalFouls: 0,
    flagrantFouls: 0,
    disqualifications: 0,
    ejections: 0,
  })

  it('single-team season → one record, no stints', () => {
    const rows: RawSeasonRow[] = [{ year: 2023, teamId: 17, gamesPlayed: 40, box: box(500), misc: misc() }]
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

  it('sums the stints when a traded year has no TOTAL row (ESPN omits it sometimes)', () => {
    // Alisia Jenkins 2020: Indiana (1 game) + Phoenix (2 games), no combined row.
    const rows: RawSeasonRow[] = [
      { year: 2020, teamId: 5, gamesPlayed: 1, box: box(4), misc: misc() },
      { year: 2020, teamId: 11, gamesPlayed: 2, box: box(6), misc: misc() },
    ]
    const result = groupSeasons(rows, 2)

    expect(result).toHaveLength(1)
    const season = result[0]!
    expect(season.isTotalRow).toBe(true)
    expect(season.teamId).toBeNull()
    expect(season.gamesPlayed).toBe(3)
    expect(season.box.points).toBe(10) // 4 + 6: the total is the sum of the stints
    expect(season.stints.map((s) => s.teamId)).toEqual([5, 11])
  })
})

describe('parseCoreSeasonBox', () => {
  // Rebekkah Brunson 2007 (Sacramento), as the core per-season endpoint returns it — a season
  // the career /stats endpoint doesn't have at all.
  const brunson2007 = {
    gamesPlayed: 33,
    points: 378,
    fieldGoalsMade: 141,
    fieldGoalsAttempted: 298,
    threePointFieldGoalsMade: 0,
    threePointFieldGoalsAttempted: 4,
    freeThrowsMade: 96,
    freeThrowsAttempted: 140,
    offensiveRebounds: 130,
    defensiveRebounds: 165,
    assists: 24,
    steals: 44,
    blocks: 31,
    turnovers: 58,
    fouls: 78,
    minutes: 932,
    doubleDouble: 10,
  }

  it('maps the flat core map to the box, defaulting absent misc counts to zero', () => {
    const season = parseCoreSeasonBox(brunson2007)!
    expect(season.gamesPlayed).toBe(33)
    expect(season.box.points).toBe(378)
    expect(season.box.fgAtt).toBe(298)
    expect(season.box.oreb + season.box.dreb).toBe(295)
    expect(season.misc.doubleDoubles).toBe(10)
    expect(season.misc.ejections).toBe(0) // absent → zero, as for /stats misc rows
  })

  it('returns null with no games, and fails loudly on a missing box key', () => {
    expect(parseCoreSeasonBox({ gamesPlayed: 0, points: 0 })).toBeNull()
    expect(parseCoreSeasonBox({})).toBeNull()
    const { fouls: _dropped, ...noFouls } = brunson2007
    expect(() => parseCoreSeasonBox(noFouls)).toThrow('missing core stat "fouls"')
  })
})

describe('isAllStarTeam', () => {
  it('flags All-Star sides by flag, slug, code or name — and never a franchise', () => {
    expect(isAllStarTeam({ isAllStar: true, displayName: 'TEAM SPOON' })).toBe(true)
    expect(isAllStarTeam({ slug: 'west' })).toBe(true) // /stats row, old All-Star game
    expect(isAllStarTeam({ abbreviation: 'WEST', name: 'WEST' })).toBe(true) // team 99 on the core endpoint
    expect(isAllStarTeam({ slug: 'all-stars' })).toBe(true)
    expect(
      isAllStarTeam({
        displayName: 'Sacramento Monarchs',
        abbreviation: 'SAC',
        slug: 'sacramento-monarchs',
        isAllStar: false,
      }),
    ).toBe(false)
    expect(isAllStarTeam({ displayName: 'Seattle Storm', abbreviation: 'SEA' })).toBe(false)
  })
})

describe('missingAppearances', () => {
  it('lists appearances with games that /stats did not return, ignoring 0-game listings', () => {
    const seasons = [
      { year: 2006, seasonType: 2 },
      { year: 2010, seasonType: 2 },
    ]
    const appearances = [
      { year: 2006, seasonType: 2, gamesPlayed: 34 }, // covered
      { year: 2007, seasonType: 2, gamesPlayed: 33 }, // the Monarchs gap
      { year: 2007, seasonType: 3, gamesPlayed: 4 }, // and its playoff run
      { year: 2008, seasonType: 3, gamesPlayed: 0 }, // listed, never played → nothing to store
    ]
    expect(missingAppearances(seasons, appearances)).toEqual([
      { year: 2007, seasonType: 2, gamesPlayed: 33 },
      { year: 2007, seasonType: 3, gamesPlayed: 4 },
    ])
  })
})

describe('extractRawRows', () => {
  // Minimal category builders. totals needs all 15 keys parseTotalsBox reads;
  // averages needs only gamesPlayed; misc needs the 6 kept keys.
  const TOTALS_NAMES = [
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
  const AVG_NAMES = ['gamesPlayed']
  const MISC_NAMES = [
    'doubleDouble',
    'tripleDouble',
    'technicalFouls',
    'flagrantFouls',
    'disqualifications',
    'ejections',
  ]

  const row = (year: number, teamId: number | null, stats: string[], teamSlug?: string) => ({
    season: { year },
    ...(teamId === null ? {} : { teamId }),
    ...(teamSlug ? { teamSlug } : {}),
    stats,
  })
  const totalsRow = (year: number, teamId: number | null, points: number, slug?: string) =>
    row(
      year,
      teamId,
      [String(points), '0', '0', '0', '0', '0', '0', '0', '0-0', '0', '0-0', '0', '0-0', '0', '0'],
      slug,
    )
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
        active: true,
        position: { abbreviation: 'G' },
        team: {
          $ref: 'http://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/seasons/2024/teams/17?lang=en',
        },
        headshot: { href: 'https://a.espncdn.com/i/headshots/wnba/players/full/3065570.png' },
        draft: { year: 2017, round: 1, selection: 1 },
      }),
    ).toEqual({
      espnId: '3065570',
      name: 'Kelsey Plum',
      position: 'G',
      jersey: 10,
      active: true,
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
      active: true, // absent → assumed active
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

  it('keeps a retired player inactive', () => {
    expect(parseBio({ id: '141', displayName: 'Cynthia Cooper', active: false }).active).toBe(false)
  })

  it('collapses doubled spaces in a name', () => {
    expect(parseBio({ id: '312', displayName: 'Deanna  Nolan' }).name).toBe('Deanna Nolan')
    expect(parseBio({ id: '369', displayName: ' Tangela  Smith ' }).name).toBe('Tangela Smith')
  })

  it('treats ESPN\'s "Not Available" position placeholder as no position', () => {
    // positions/0 — what ESPN returns for most players who played before ~2012, on the bio and
    // on every season row alike (Cynthia Cooper, Sheryl Swoopes…). Never a position of its own.
    const cooper = { id: '141', displayName: 'Cynthia Cooper' }
    expect(parseBio({ ...cooper, position: { id: '0', abbreviation: 'NA' } }).position).toBeNull()
    expect(parseBio({ ...cooper, position: { abbreviation: 'NA' } }).position).toBeNull()
    expect(parseBio({ ...cooper, position: { id: '0' } }).position).toBeNull()
    // A real position still comes through untouched.
    expect(parseBio({ ...cooper, position: { id: '3', abbreviation: 'G' } }).position).toBe('G')
  })
})
