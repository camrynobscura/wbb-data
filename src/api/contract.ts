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

/** Row in `GET /players` — the select-screen list (no seasons, keep it light). */
export interface PlayerSummary {
  id: string // DB players.id, stringified
  espn: string // players.espn_id — the frontend builds the headshot URL from this
  name: string
  team: string | null // current-era name of the player's current team; null if off-roster
  teamAbbr: string | null
  pos: string | null // players.position
  jersey: number | null // scraped from the bio endpoint (Phase 3 add)
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

  // ── advanced / role (for a future advanced section) — season RATES ──
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
 * `GET /meta` — global data-freshness signal for the UI's "Data current as of …"
 * line. `lastScrapedAt` is the finish time of the most recent SUCCESSFUL scrape
 * run as an ISO 8601 UTC string, or null if no successful run has completed yet.
 */
export interface Meta {
  lastScrapedAt: string | null
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
}
