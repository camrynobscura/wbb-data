/**
 * A made-up league for the database tests, one season per question, small enough that every expected
 * number can be worked out by hand (the tests show the arithmetic). Team 6 played 34 games in each season,
 * team 17 played 33.
 *
 *   2019: who qualifies (at least 20 of 44 games scaled to the player's own team: 16 of 34, 15 of 33), ranks
 *         and ties, the league averages, the position buckets (8 qualified guards make one; 7 forwards and 3
 *         centers don't), and a traded player's team games (the last team's, never fewer than her own).
 *   2018: the shooting-% rank floors: attempts or makes, scaled to the team's games, and the fixed color floor.
 *   2010: a qualified player with no position on record, so that season has no position averages or ranks.
 *
 * computeLeague asks ESPN for each season's total: a test file seeding this league mocks src/espn/client
 * and answers fetchTeamGames from SLATES.
 */
import type { Pool } from 'pg'
import type { PlayerBio, SeasonRecord } from '../espn/parse'
import { computeLeague } from '../db/computeLeague'
import { computePositions } from '../db/computePositions'
import { ingestPlayer } from '../db/ingest'
import { currentSeason } from '../seasons'
import { bio, season, setTeamGames, T1, T2, tradedSeason } from './db'

interface FixturePlayer {
  name: string
  pos: string | null
  seasons: SeasonRecord[]
  extra?: Partial<Pick<PlayerBio, 'birthDate'>>
}

const p = (
  name: string,
  pos: string | null,
  seasons: SeasonRecord[],
  extra?: FixturePlayer['extra'],
): FixturePlayer => ({
  name,
  pos,
  seasons,
  extra,
})

// Guards take 200 shots each, over the FG% rank floor at 34 games (200 × 34 / 44 = 155 attempts), so eight of
// them rank in FG%. Everyone else takes 100, under it. Only G1 clears the 3P% floor.
const G = (name: string, pts: number, fgMade: number, gp = 20) =>
  p(name, 'G', [season(2019, T1, { gp, pts, fg: [fgMade, 200] })])
const F = (name: string, pts: number, team = T1, gp = 20) =>
  p(name, 'F', [season(2019, team, { gp, pts, fg: [40, 100] })])

export const LEAGUE: FixturePlayer[] = [
  // ── 2019: points picked for the ranks, not made from the shots (2018's are) ──
  p(
    'G1',
    'G',
    [
      season(2017, T1, { gp: 20, pts: 300, fg: [60, 150] }),
      season(2019, T1, { gp: 20, pts: 400, fg: [100, 200], fg3: [30, 100], ast: 160 }),
      season(2019, T1, { gp: 10, pts: 500 }, 3), // playoffs: 50 a game, in no average or rank
    ],
    { birthDate: '1996-08-08' },
  ),
  p('G2', 'G', [season(2019, T1, { gp: 20, pts: 300, fg: [90, 200], stl: 40 })]),
  G('G3', 300, 90),
  G('G4', 200, 80),
  G('G5', 160, 70),
  G('G6', 120, 60),
  G('G7', 100, 50),
  G('G8', 64, 40, 16), // 16 of 34 games: 16 × 44 = 704 ≥ 20 × 34 = 680, qualifies
  G('N1', 450, 90, 15), // 15 of 34: 660 < 680, doesn't qualify; 30 a game would lead the league
  F('F1', 360),
  F('F2', 240),
  F('F3', 220),
  F('F4', 180),
  F('F5', 140),
  F('F6', 60),
  F('B1', 150, T2, 15), // 15 of 33: 15 × 44 = 660 ≥ 20 × 33 = 660, qualifies
  p('C1', 'C', [season(2019, T1, { gp: 20, pts: 500, fg: [10, 10], ft: [40, 50], reb: 300, blk: 60 })]),
  // Traded, team 6 then team 17 (33 games): TR's games bar is 33, TR2's is her own 34.
  p('TR', 'C', [
    tradedSeason(2019, { gp: 30, pts: 225, fg: [40, 100] }, [
      [T1, 16],
      [T2, 14],
    ]),
  ]),
  p('TR2', 'C', [
    tradedSeason(2019, { gp: 34, pts: 221, fg: [40, 100] }, [
      [T1, 20],
      [T2, 14],
    ]),
  ]),

  // ── 2018: shooting floors. At 34 games: FG% 155 attempts or 66 made, 3P% 47 or 16, TS% 96.6 shooting
  //    possessions (FGA + 0.44 × FTA); at 33 games FG% needs 64 made. Color floors: 100 FGA, 40 3PA, 100
  //    possessions. Points are 2 × FGM + 3PM + FTM. ──
  p('S1', 'F', [season(2018, T1, { gp: 20, pts: 136, fg: [60, 100], fg3: [16, 40] })]),
  p('S2', 'F', [season(2018, T1, { gp: 20, pts: 147, fg: [66, 150], fg3: [15, 47] })]),
  p('S3', 'F', [season(2018, T1, { gp: 20, pts: 145, fg: [65, 155], fg3: [15, 46] })]),
  p('S4', 'F', [season(2018, T1, { gp: 20, pts: 120, fg: [50, 99], fg3: [20, 39] })]),
  p('S5', 'F', [season(2018, T1, { gp: 20, pts: 145, fg: [70, 99], ft: [5, 5] })]),
  p('S6', 'F', [season(2018, T2, { gp: 20, pts: 128, fg: [64, 150] })]),
  p('S7', 'F', [season(2018, T1, { gp: 20, pts: 128, fg: [64, 150] })]),

  // ── 2010: eight qualified guards, but one qualified player has no position ──
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => p(`H${i}`, 'G', [season(2010, T1, { gp: 20, pts: 100 * i })])),
  p('U1', null, [season(2010, T1, { gp: 20, pts: 50 })]),
]

/** Each season's total, one team's count (what fetchTeamGames('6', year) answers). */
export const SLATES: Record<number, number> = { 2010: 34, 2017: 34, 2018: 34, 2019: 34 }

/** Ingest the league the way a scrape does, then compute the league and position averages. */
export async function seedLeague(pool: Pool): Promise<void> {
  for (const [i, pl] of LEAGUE.entries()) {
    await ingestPlayer(pool, bio(String(1000 + i), pl.name, pl.pos, pl.extra), pl.seasons, currentSeason())
  }
  await setTeamGames(pool, [
    [T1, 2010, 34],
    [T1, 2017, 34],
    [T1, 2018, 34],
    [T2, 2018, 33],
    [T1, 2019, 34],
    [T2, 2019, 33],
  ])
  await computeLeague(pool)
  await computePositions(pool)
}

/** A player's id, by name. */
export async function idOf(pool: Pool, name: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM players WHERE name = $1`, [name])
  if (rows.length !== 1) throw new Error(`idOf: ${rows.length} players named ${name}`)
  return rows[0]!.id
}
