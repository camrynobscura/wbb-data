/**
 * THE API CONTRACT (Phase 3, step 3a).
 *
 * This is the cross-repo boundary: the exact JSON shape the read API returns and
 * the frontend consumes. wnba-data is the source of truth; wnba-arc keeps its own
 * mirror of these types (no shared package for v1). If this shape changes, both
 * repos change together.
 *
 * Design decisions baked in here (confirmed 2026-08-19):
 *  - Basic counting stats (pts/reb/ast/stl/blk/min) are PER-GAME (totals ÷ gp),
 *    matching the frontend. fgp/tpp are decimals (0.466 = 46.6%).
 *  - Advanced/role stats are included now (unused by today's UI, ready for a future
 *    "advanced stats" section) — they're season rates, not per-game.
 *  - `id` is the DB numeric primary key as a string. Nullable fields return null
 *    rather than a fake 0/"".
 *  - v1 is REGULAR season only (season_type = 2); traded seasons use the combined
 *    canonical row. Playoffs are a later toggle.
 */

/**
 * Row in `GET /players` — the select-screen list (no seasons, keep it light).
 * `?scope=current` (the default) lists the rolling window — anyone with a season in the last
 * 3 years, the set the app has always shown; `?scope=all` lists every player on record since
 * 1997, retired included.
 */
export interface PlayerSummary {
  id: string // DB players.id, stringified
  espn: string // players.espn_id — the frontend builds the headshot URL from this
  name: string
  team: string | null // current-era name of the player's current team; null if off-roster or retired
  teamAbbr: string | null
  pos: string | null // players.position
  jersey: number | null // scraped from the bio endpoint (Phase 3 add)
  active: boolean // ESPN's "still playing" flag; false once retired (a retired player has no team)
  firstYear: number | null // first and last regular season on record — the career span;
  lastYear: number | null //  null only for a player with no regular-season row
}

/** `GET /players/:id` — one player with full career. */
export interface PlayerDetail extends PlayerSummary {
  seasons: Season[] // regular season only, ascending by year, gaps filled as "missed"
}

export type Season = SeasonPlayed | SeasonMissed

export interface SeasonPlayed {
  year: number
  played: true
  age: number | null // season_year − year(birth_date); null if birth_date unknown
  gp: number

  // ── basic (what the current UI shows) — PER-GAME, except fgp/tpp = decimals ──
  min: number | null // minutes ÷ gp; null when minutes weren't available (~10%)
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
  fgp: number | null // fg_made / fg_att; null if 0 attempts
  tpp: number | null // fg3_made / fg3_att; null if 0 attempts

  // Raw makes/attempts behind fgp/tpp. Kept on the wire so the frontend can build rate
  // baselines by POOLING totals (SUM(made)/SUM(att)) instead of averaging season
  // percentages, and can gate seasons with too few attempts — a % on a handful of shots is
  // noise (e.g. 1-for-1 = 100%). Always present (NOT NULL integers in player_seasons).
  fgMade: number
  fgAtt: number
  fg3Made: number
  fg3Att: number

  // ── league rank (counting stats only) ──
  // `pool` = how many player-seasons qualified for that year's league averages (>= SMALL_SAMPLE_FRACTION
  // of the slate — the same set the ladders and stddevs are computed from, so "3rd of 141" and the
  // percentile never disagree). Null only if the year has no league row. `rank` = this season's place in
  // that pool per stat, 1 = best, ties share a rank (RANK(), so 1, 1, 3); null when the season itself
  // didn't qualify (small sample) or there's no pool. The pool is every qualified player on record for
  // that season — the whole league, since every player who has played since 1997 is on record.
  pool: number | null
  rank: { pts: number; reb: number; ast: number; stl: number; blk: number } | null
  // The same two, among the player's OWN POSITION that year — the crowd the /positions averages
  // describe, gated the same way: the bucket has >= 8 qualified players (computePositions.MIN_QUALIFIED)
  // AND every qualified player that year has a known position (ESPN has none for most pre-2012
  // players, so a position crowd for those years would be incomplete — migration 005). Where
  // /positions has no (year, position) row, both are null. Also null when the player has no position.
  // The position is the player's current one (players.position), as for the position averages.
  posPool: number | null
  posRank: { pts: number; reb: number; ast: number; stl: number; blk: number } | null

  // ── advanced / role (for a future advanced section) — season RATES ──
  // NOT READY FOR ANY UI (2026-09-24): usgPct/astPct are 0–100 while the five below are 0–1, and
  // the stored values include junk (2001 minutes, 2005 team totals). Normalize + clean first —
  // wnba-data/DATA-NOTES.md "Advanced rates … NOT ready for any UI" has the measurements and plan.
  tsPct: number | null
  efgPct: number | null
  tovPct: number | null
  fg3aRate: number | null
  ftRate: number | null
  usgPct: number | null // 2nd-pass; ~86% coverage
  astPct: number | null
  orebPct: number | null // intentionally null for v1 (no ESPN opponent rebounds)
  drebPct: number | null
  trebPct: number | null
}

export interface SeasonMissed {
  year: number
  played: false
  reason: string // always "Did not play" — ESPN has no historical injury data
}

/**
 * `GET /meta` — global data-freshness signals.
 * - `statsThrough`: "YYYY-MM-DD" (Eastern calendar date) of the latest COMPLETED regular-season
 *   game the nightly refresh saw on ESPN's schedules — the footer's "Stats through Sep 23, 2026".
 *   In-season it is yesterday's games; in the playoffs and the off-season it stays on the last
 *   regular-season game (playoffs aren't served), which is the point: the old "Data current as of
 *   <run time>" read as if something had changed yesterday in February. Null until a refresh has
 *   recorded one (migration 007, 2026-09-24).
 * - `lastScrapedAt`: the finish time of the most recent SUCCESSFUL scrape run as an ISO 8601 UTC
 *   string, or null if none has completed — "checked nightly", for the About page and operators.
 */
export interface Meta {
  lastScrapedAt: string | null
  statsThrough: string | null
}

/**
 * The five COUNTING stats carry a spread + percentile ladder (the deviation bars measure in
 * "league-steps" = distance ÷ spread; the shooting %s keep their relative-% bar, so they get
 * neither). Both are per-season and describe that season's qualified-player population.
 */
export interface StatSpread {
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
}
/**
 * Value-at-percentile ladder per counting stat: 11 values at the 0,10,…,100th percentiles
 * (deciles) of that stat across the season's qualified players. The frontend interpolates a
 * player's value into a percentile from this ladder — the decile spacing is the contract.
 */
export interface StatPctiles {
  pts: number[]
  reb: number[]
  ast: number[]
  stl: number[]
  blk: number[]
}

/**
 * Row in `GET /league` — per-year league context (averages + slate length).
 * Feeds the frontend's league-comparison baseline and small-sample denominator.
 * Basic averages mirror the 7 displayed stats; advanced averages support the
 * future advanced section.
 */
export interface LeagueSeason {
  year: number
  scheduledGames: number // real slate (fetched per season; see compute-league.ts)

  // basic league averages (per-game / decimals), matching the 7 UI stats
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
  fgp: number // NEW league column (Phase 3 add) — league FG%
  tpp: number // NEW league column (Phase 3 add) — league 3P%

  // advanced league averages
  tsPct: number
  efgPct: number
  tovPct: number
  fg3aRate: number
  ftRate: number

  // Spread (population stddev) + percentile ladders of the counting stats — the deviation
  // bars' ruler and the tooltip's percentile. Null on rows computed before migration 004
  // (the frontend then falls back to the old relative-% bar). See src/db/spread.ts.
  stdev: StatSpread | null
  pctiles: StatPctiles | null
}

/**
 * Per-season, per-position league averages — the "compare to same position" baseline.
 * Same stat fields as LeagueSeason (minus the league-wide scheduledGames), plus which
 * position (G/F/C) and how many players fed the row. A (year, position) with too small a
 * sample is simply ABSENT (minimum 8 qualified players; see the position_seasons table /
 * computePositions.ts), which the frontend reads as "no same-position sample that season".
 */
export interface PositionSeason {
  year: number
  position: string // G / F / C
  qualifiedPlayers: number

  // basic averages, matching the 7 UI stats
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

  // The POSITION's own spread + percentile ladders (see StatSpread/StatPctiles). Position bars
  // measure against how this position varies. Null on pre-004 rows.
  stdev: StatSpread | null
  pctiles: StatPctiles | null
}
