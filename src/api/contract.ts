/**
 * The API contract: the JSON the read API returns and the frontend reads. wnba-data is the source of
 * truth; wnba-arc keeps its own copy of these types (src/data/api.ts), so a change here means a change
 * there.
 *
 *  - Counting stats (pts/reb/ast/stl/blk/min) are per game (totals ÷ gp); fgp/tpp are decimals
 *    (0.466 = 46.6%). The advanced rates are season rates.
 *  - `id` is the database primary key as a string. Missing values are null, never a fake 0 or "".
 *  - Regular season only (season_type = 2); a traded player's season is the combined row.
 */

/**
 * A row in `GET /players` (no seasons, to keep it light). `?scope=current` (the default) lists anyone with
 * a season in the last 3 years; `?scope=all` lists every player since 1997, retired included.
 */
export interface PlayerSummary {
  id: string // DB players.id, stringified
  espn: string // players.espn_id: the frontend builds the headshot URL from it
  name: string
  team: string | null // the current name of the player's current team; null when off a roster
  teamAbbr: string | null
  pos: string | null // players.position
  jersey: number | null // from ESPN's bio endpoint
  active: boolean // ESPN's flag: false for retired and waived players alike, so not a retirement record
  firstYear: number | null // first and last regular season on record, the career span;
  lastYear: number | null //  null only for a player with no regular-season row
}

/** `GET /players/:id`: one player with their full career. */
export interface PlayerDetail extends PlayerSummary {
  seasons: Season[] // regular season only, ascending by year, gaps filled as "missed"
}

export type Season = SeasonPlayed | SeasonMissed

export interface SeasonPlayed {
  year: number
  played: true
  age: number | null // season_year − year(birth_date); null if birth_date unknown
  gp: number
  // The games the player's team played that season (so far, in a season in progress): the Y in "17 of Y
  // games" and what every games bar scales by (small sample, partial, qualified, the shooting-% rank
  // floors). The last team, if traded; never less than gp. Falls back to the season total
  // (LeagueSeason.scheduledGames) for a team with no count. Migration 008.
  teamGames: number

  // ── basic: per game, except fgp/tpp (decimals) ──
  min: number | null // minutes ÷ gp; null when ESPN has no minutes
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
  fgp: number | null // fg_made / fg_att; null if 0 attempts
  tpp: number | null // fg3_made / fg3_att; null if 0 attempts

  // The makes and attempts behind fgp/tpp, so the frontend can pool totals (SUM(made) / SUM(att)) rather
  // than average season percentages, and skip seasons with too few attempts (a 1-for-1 is 100%). Always
  // present.
  fgMade: number
  fgAtt: number
  fg3Made: number
  fg3Att: number
  // Free throws and the season's total points, so the frontend can pool TS% the same way
  // (SUM(points) / 2(SUM(fga) + 0.44 × SUM(fta))) and gate it on TS attempts.
  ftMade: number
  ftAtt: number
  ptsTotal: number

  // ── league rank ──
  // `pool`: how many player-seasons qualified for that year's league averages (QUALIFYING_GAMES of
  // FULL_SCHEDULE_GAMES, scaled to the team's games), the same set the spreads come from. Null only if
  // the year has no league row. `rank`: this season's place in that pool per stat, 1 = best, ties
  // sharing a rank (RANK(): 1, 1, 3); null when the season didn't qualify or there's no pool.
  // The shooting percentages rank in a smaller pool: the qualified seasons that also cleared that stat's
  // rank floor (queries.ts RATE_RANK_FLOOR) and its color floor (RATE_TINT_FLOOR, so a ranked season is
  // always a colored one), so a 4-of-10 can't lead the league. `ratePool` is that count per stat, and a
  // rate key in `rank` is null when this season is under either (the counting keys never are).
  pool: number | null
  rank: SeasonRanks | null
  ratePool: { fgp: number; tpp: number; tsPct: number } | null
  // The same among the player's position that year, gated like /positions: the group has at least 8
  // qualified players (computePositions.MIN_QUALIFIED) and every qualified player that year has a known
  // position (ESPN has none for most players before 2012, so those crowds would be incomplete; migration
  // 005). Otherwise, or when the player has no position, all are null. The position is the player's
  // current one. A percentage's position pool is null, and its rank with it, when fewer than 8 at the
  // position cleared the floor: no "1st of 3 centers".
  posPool: number | null
  posRank: SeasonRanks | null
  posRatePool: { fgp: number | null; tpp: number | null; tsPct: number | null } | null

  // ── advanced: season rates ──
  // Not ready for any UI except tsPct: usgPct/astPct are 0–100 while the others are 0–1, and the stored
  // values include junk (2001 minutes, 2005 team totals). They need normalizing and cleaning first.
  tsPct: number | null
  efgPct: number | null
  tovPct: number | null
  fg3aRate: number | null
  ftRate: number | null
  usgPct: number | null // 2nd-pass; ~86% coverage
  astPct: number | null
  orebPct: number | null // always null: ESPN has no opponent rebounds
  drebPct: number | null
  trebPct: number | null
}

/** A season's place per stat, 1 = best. A shooting % is null when the season is under that stat's
    floor (see SeasonPlayed.ratePool). */
export interface SeasonRanks {
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
  fgp: number | null
  tpp: number | null
  tsPct: number | null
}

export interface SeasonMissed {
  year: number
  played: false
  reason: string // always "Did not play": ESPN has no historical injury data
}

/**
 * `GET /meta`: data freshness.
 * - `statsThrough`: "YYYY-MM-DD" (Eastern date) of the latest completed regular-season game the daily
 *   refresh saw on ESPN's schedules: the footer's "Stats through Sep 23, 2026". In the playoffs and the
 *   offseason it stays on the last regular-season game (playoffs aren't served). Null until a refresh has
 *   recorded one (migration 007).
 * - `lastScrapedAt`: when the latest successful scrape finished (ISO 8601 UTC), or null if none has.
 */
export interface Meta {
  lastScrapedAt: string | null
  statsThrough: string | null
}

/**
 * The five counting stats carry a spread (population standard deviation) and a decile ladder; the
 * shooting %s get neither. Both describe that season's qualified players. The frontend measures a gap in
 * standard deviations.
 */
export interface StatSpread {
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
}
/**
 * Value at each decile per counting stat: 11 values, at the 0th, 10th, …, 100th percentiles of the
 * season's qualified players. Served, but the current frontend doesn't read it.
 */
export interface StatPctiles {
  pts: number[]
  reb: number[]
  ast: number[]
  stl: number[]
  blk: number[]
}

/** A row in `GET /league`: that year's league averages and schedule length. */
export interface LeagueSeason {
  year: number
  scheduledGames: number // the season total (one team's count — see computeLeague.ts); a player's own bar is SeasonPlayed.teamGames

  // basic averages (per game, or decimals)
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
  fgp: number
  tpp: number

  // advanced averages
  tsPct: number
  efgPct: number
  tovPct: number
  fg3aRate: number
  ftRate: number

  // The counting stats' spreads and ladders (src/db/spread.ts). Null on rows computed before migration 004.
  stdev: StatSpread | null
  pctiles: StatPctiles | null
}

/**
 * Per-season, per-position averages: the same fields as LeagueSeason (minus scheduledGames), plus the
 * position (G/F/C) and how many players fed the row. A (year, position) with fewer than 8 qualified
 * players is absent (computePositions.ts).
 */
export interface PositionSeason {
  year: number
  position: string // G / F / C
  qualifiedPlayers: number

  // basic averages
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
  fgp: number
  tpp: number

  // advanced averages
  tsPct: number
  efgPct: number
  tovPct: number
  fg3aRate: number
  ftRate: number

  // The position's own spreads and ladders. Null on rows from before migration 004.
  stdev: StatSpread | null
  pctiles: StatPctiles | null
}
