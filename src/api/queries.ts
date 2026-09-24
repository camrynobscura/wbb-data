/**
 * Shaping layer (Phase 3, step 3b). Framework-agnostic: each function takes a pg
 * Pool and returns the API contract types. Express routes are thin wrappers over
 * these — no SQL or shaping logic lives in the HTTP layer.
 *
 * Two pg gotchas handled here:
 *  - bigint columns (ids) come back as strings — already what the contract wants.
 *  - numeric columns (minutes, all rate stats) come back as STRINGS to preserve
 *    precision — we Number() them.
 */
import type { Pool } from 'pg'
import { SMALL_SAMPLE_FRACTION } from '../db/computeLeague'
import { MIN_QUALIFIED } from '../db/computePositions'
import { currentSeason, windowStart } from '../seasons'
import type {
  LeagueSeason,
  Meta,
  PlayerDetail,
  PlayerSummary,
  PositionSeason,
  Season,
  SeasonPlayed,
  StatPctiles,
  StatSpread,
} from './contract'

// ── number helpers ───────────────────────────────────────────────────────────
/** Per-game value, 1 decimal (matches the frontend's precision). */
const perGame = (total: number, gp: number): number =>
  Math.round((total / gp) * 10) / 10
/** made/att as a decimal to 3 places; null when there were no attempts. */
const ratio = (made: number, att: number): number | null =>
  att > 0 ? Math.round((made / att) * 1000) / 1000 : null
/** A pg numeric (string | null) → number to 3 places, or null. */
const num3 = (v: unknown): number | null =>
  v == null ? null : Math.round(Number(v) * 1000) / 1000

// ── player summary (shared by list + detail) ─────────────────────────────────
interface SummaryRow {
  id: string
  espn_id: string
  name: string
  position: string | null
  jersey: number | null
  active: boolean
  birth_date: string | null
  team_name: string | null
  team_abbr: string | null
  first_year: number | null
  last_year: number | null
}

// One SELECT for the list and the detail. first/last year come from the regular seasons on
// record (a player with only playoff rows would read null for both).
const SUMMARY_SELECT = `
  SELECT p.id, p.espn_id, p.name, p.position, p.jersey, p.active, p.birth_date,
         v.team_name, v.team_abbr, y.first_year, y.last_year
  FROM players p
  LEFT JOIN player_current_team v ON v.player_id = p.id
  LEFT JOIN (
    SELECT player_id, MIN(season_year) AS first_year, MAX(season_year) AS last_year
    FROM player_seasons WHERE season_type = 2 GROUP BY player_id
  ) y ON y.player_id = p.id`

function toSummary(r: SummaryRow): PlayerSummary {
  return {
    id: r.id,
    espn: r.espn_id,
    name: r.name,
    team: r.team_name,
    teamAbbr: r.team_abbr,
    pos: r.position,
    jersey: r.jersey,
    active: r.active,
    firstYear: r.first_year,
    lastYear: r.last_year,
  }
}

/** Which players GET /players lists — see getPlayers. */
export type PlayerScope = 'current' | 'all'

/**
 * GET /players — alphabetical. `current` (the default) is the rolling window (D1): anyone with a
 * season, regular or playoff, in the last ROSTER_WINDOW_YEARS years — the universe the app has
 * always shown, now derived from the data rather than from what was ingested. `all` is every
 * player in the database, retired included, for a client that shows league history.
 */
export async function getPlayers(pool: Pool, scope: PlayerScope = 'current'): Promise<PlayerSummary[]> {
  const inWindow = `WHERE EXISTS (
    SELECT 1 FROM player_seasons ps WHERE ps.player_id = p.id AND ps.season_year >= $1)`
  const { rows } = await pool.query<SummaryRow>(
    `${SUMMARY_SELECT} ${scope === 'all' ? '' : inWindow} ORDER BY p.name`,
    scope === 'all' ? [] : [windowStart(currentSeason())],
  )
  return rows.map(toSummary)
}

// ── one player's seasons ─────────────────────────────────────────────────────
interface SeasonRow {
  season_year: number
  games_played: number
  minutes: string | null
  points: number
  fg_made: number
  fg_att: number
  fg3_made: number
  fg3_att: number
  rebounds: number
  assists: number
  steals: number
  blocks: number
  ts_pct: string | null
  efg_pct: string | null
  tov_pct: string | null
  fg3a_rate: string | null
  ft_rate: string | null
  usg_pct: string | null
  ast_pct: string | null
  oreb_pct: string | null
  dreb_pct: string | null
  treb_pct: string | null
}

interface RankRow {
  season_year: number
  pool: string // bigint from COUNT(*) OVER — pg returns it as text
  r_pts: string | null
  r_reb: string | null
  r_ast: string | null
  r_stl: string | null
  r_blk: string | null
  // Among the player's own position that year (null when the bucket is thinner than MIN_QUALIFIED,
  // exactly when /positions omits it, or the player has no position).
  pos_pool: string | null
  p_pts: string | null
  p_reb: string | null
  p_ast: string | null
  p_stl: string | null
  p_blk: string | null
}

// Where each of a player's seasons ranks among that year's QUALIFIED player-seasons — the same pool
// computeLeague.ts averages over (>= SMALL_SAMPLE_FRACTION of the stored slate), so rank and percentile
// describe the same crowd. One window pass over the player's years only; the player's own rows are
// then picked out. A season that doesn't qualify gets no row here → rank null, pool still known.
// A second set of windows partitions by position — the same crowd computePositions.ts averages
// over, gated the same two ways so a position rank exists only where the position average does:
// the bucket has >= $3 (MIN_QUALIFIED) players, AND the season is position-complete — every
// qualified player that year has a position (league_seasons.qualified_with_position =
// qualified_players, migration 005; ESPN has no position for most pre-2012 players). The
// completeness check lives in pos_pools, so an incomplete year simply has no position pool.
const RANK_SQL = `
WITH pool AS (
  SELECT ps.player_id, ps.season_year, ps.games_played, p.position,
         ps.points, ps.rebounds, ps.assists, ps.steals, ps.blocks
  FROM player_seasons ps
  JOIN players p         ON p.id = ps.player_id
  JOIN league_seasons ls ON ls.season_year = ps.season_year
  WHERE ps.season_type = 2
    AND ps.games_played >= $2::numeric * ls.scheduled_games
    AND ps.season_year IN (SELECT season_year FROM player_seasons WHERE player_id = $1 AND season_type = 2)
),
ranked AS (
  SELECT player_id, season_year,
         COUNT(*) OVER (PARTITION BY season_year) AS pool,
         RANK() OVER (PARTITION BY season_year ORDER BY points::numeric   / games_played DESC) AS r_pts,
         RANK() OVER (PARTITION BY season_year ORDER BY rebounds::numeric / games_played DESC) AS r_reb,
         RANK() OVER (PARTITION BY season_year ORDER BY assists::numeric  / games_played DESC) AS r_ast,
         RANK() OVER (PARTITION BY season_year ORDER BY steals::numeric   / games_played DESC) AS r_stl,
         RANK() OVER (PARTITION BY season_year ORDER BY blocks::numeric   / games_played DESC) AS r_blk,
         RANK() OVER (PARTITION BY season_year, position ORDER BY points::numeric   / games_played DESC) AS p_pts,
         RANK() OVER (PARTITION BY season_year, position ORDER BY rebounds::numeric / games_played DESC) AS p_reb,
         RANK() OVER (PARTITION BY season_year, position ORDER BY assists::numeric  / games_played DESC) AS p_ast,
         RANK() OVER (PARTITION BY season_year, position ORDER BY steals::numeric   / games_played DESC) AS p_stl,
         RANK() OVER (PARTITION BY season_year, position ORDER BY blocks::numeric   / games_played DESC) AS p_blk
  FROM pool
),
pools AS (SELECT season_year, COUNT(*) AS pool FROM pool GROUP BY season_year),
pos_pools AS (
  SELECT pool.season_year, COUNT(*) AS pos_pool
  FROM pool
  JOIN league_seasons ls ON ls.season_year = pool.season_year
  WHERE pool.position = (SELECT position FROM players WHERE id = $1)
    AND ls.qualified_with_position = ls.qualified_players
  GROUP BY pool.season_year
)
SELECT p.season_year, p.pool,
       r.r_pts, r.r_reb, r.r_ast, r.r_stl, r.r_blk,
       CASE WHEN pp.pos_pool >= $3::int THEN pp.pos_pool END AS pos_pool,
       CASE WHEN pp.pos_pool >= $3::int THEN r.p_pts END AS p_pts,
       CASE WHEN pp.pos_pool >= $3::int THEN r.p_reb END AS p_reb,
       CASE WHEN pp.pos_pool >= $3::int THEN r.p_ast END AS p_ast,
       CASE WHEN pp.pos_pool >= $3::int THEN r.p_stl END AS p_stl,
       CASE WHEN pp.pos_pool >= $3::int THEN r.p_blk END AS p_blk
FROM pools p
LEFT JOIN ranked r    ON r.season_year = p.season_year AND r.player_id = $1
LEFT JOIN pos_pools pp ON pp.season_year = p.season_year
ORDER BY p.season_year`

function toSeasonPlayed(r: SeasonRow, birthYear: number | null, rk: RankRow | undefined): SeasonPlayed {
  const gp = r.games_played
  const rank =
    rk && rk.r_pts != null
      ? { pts: Number(rk.r_pts), reb: Number(rk.r_reb), ast: Number(rk.r_ast), stl: Number(rk.r_stl), blk: Number(rk.r_blk) }
      : null
  const posRank =
    rk && rk.p_pts != null
      ? { pts: Number(rk.p_pts), reb: Number(rk.p_reb), ast: Number(rk.p_ast), stl: Number(rk.p_stl), blk: Number(rk.p_blk) }
      : null
  return {
    year: r.season_year,
    played: true,
    age: birthYear === null ? null : r.season_year - birthYear,
    gp,
    pool: rk ? Number(rk.pool) : null,
    rank,
    posPool: rk && rk.pos_pool != null ? Number(rk.pos_pool) : null,
    posRank,
    min: r.minutes === null ? null : perGame(Number(r.minutes), gp),
    pts: perGame(r.points, gp),
    reb: perGame(r.rebounds, gp),
    ast: perGame(r.assists, gp),
    stl: perGame(r.steals, gp),
    blk: perGame(r.blocks, gp),
    fgp: ratio(r.fg_made, r.fg_att),
    tpp: ratio(r.fg3_made, r.fg3_att),
    // Raw pairs too (already selected above) — the frontend pools/gates rate stats from these.
    fgMade: r.fg_made,
    fgAtt: r.fg_att,
    fg3Made: r.fg3_made,
    fg3Att: r.fg3_att,
    tsPct: num3(r.ts_pct),
    efgPct: num3(r.efg_pct),
    tovPct: num3(r.tov_pct),
    fg3aRate: num3(r.fg3a_rate),
    ftRate: num3(r.ft_rate),
    usgPct: num3(r.usg_pct),
    astPct: num3(r.ast_pct),
    orebPct: num3(r.oreb_pct),
    drebPct: num3(r.dreb_pct),
    trebPct: num3(r.treb_pct),
  }
}

/** Fill year-gaps between a player's first and last played season with "missed" rows. */
function withMissedSeasons(played: SeasonPlayed[]): Season[] {
  if (played.length === 0) return []
  const byYear = new Map(played.map((s) => [s.year, s]))
  const first = played[0]!.year
  const last = played[played.length - 1]!.year
  const out: Season[] = []
  for (let y = first; y <= last; y++) {
    out.push(byYear.get(y) ?? { year: y, played: false, reason: 'Did not play' })
  }
  return out
}

/** GET /players/:id — one player + full regular-season history. null if not found. */
export async function getPlayer(pool: Pool, id: string): Promise<PlayerDetail | null> {
  const summaryRes = await pool.query<SummaryRow>(`${SUMMARY_SELECT} WHERE p.id = $1`, [id])
  const row = summaryRes.rows[0]
  if (!row) return null
  const birthYear = row.birth_date ? new Date(row.birth_date).getUTCFullYear() : null

  const seasonRes = await pool.query<SeasonRow>(
    `SELECT season_year, games_played, minutes, points, fg_made, fg_att,
            fg3_made, fg3_att, rebounds, assists, steals, blocks,
            ts_pct, efg_pct, tov_pct, fg3a_rate, ft_rate, usg_pct, ast_pct,
            oreb_pct, dreb_pct, treb_pct
     FROM player_seasons
     WHERE player_id = $1 AND season_type = 2
     ORDER BY season_year`,
    [id],
  )
  const rankRes = await pool.query<RankRow>(RANK_SQL, [id, SMALL_SAMPLE_FRACTION, MIN_QUALIFIED])
  const rankByYear = new Map(rankRes.rows.map((r) => [r.season_year, r]))
  const played = seasonRes.rows.map((r) => toSeasonPlayed(r, birthYear, rankByYear.get(r.season_year)))
  return { ...toSummary(row), seasons: withMissedSeasons(played) }
}

// ── data freshness ───────────────────────────────────────────────────────────
/** GET /meta — finish time of the most recent successful scrape (or null), and "stats through":
    the latest completed game date from the most recent successful run that recorded one (a run
    whose schedule fetch failed, or a full historical scrape, leaves it null — fall through to the
    last one that knew). The date column is cast to text so it arrives as "YYYY-MM-DD", not a
    Date at local midnight. */
export async function getMeta(pool: Pool): Promise<Meta> {
  const { rows } = await pool.query<{ finished_at: Date | null; stats_through: string | null }>(
    `SELECT
       (SELECT finished_at FROM scrape_runs
         WHERE status = 'success' AND finished_at IS NOT NULL
         ORDER BY finished_at DESC LIMIT 1) AS finished_at,
       (SELECT last_game_date::text FROM scrape_runs
         WHERE status = 'success' AND last_game_date IS NOT NULL
         ORDER BY finished_at DESC LIMIT 1) AS stats_through`,
  )
  const finishedAt = rows[0]?.finished_at ?? null
  return {
    lastScrapedAt: finishedAt ? finishedAt.toISOString() : null,
    statsThrough: rows[0]?.stats_through ?? null,
  }
}

// ── deviation spread + percentile ladders (shared by league + position) ───────
// migration 004. stddev_* come back as pg numeric strings; pctiles is jsonb already parsed to
// a JS object of number arrays (deciles). Both are NULL on rows computed before 004.
interface SpreadRow {
  stddev_points: string | null
  stddev_rebounds: string | null
  stddev_assists: string | null
  stddev_steals: string | null
  stddev_blocks: string | null
  pctiles: { points: number[]; rebounds: number[]; assists: number[]; steals: number[]; blocks: number[] } | null
}
// SELECT list for the six 004 columns — kept identical between the two queries.
const SPREAD_COLS = `stddev_points, stddev_rebounds, stddev_assists, stddev_steals, stddev_blocks, pctiles`

const mapStdev = (r: SpreadRow): StatSpread | null =>
  r.stddev_points == null
    ? null
    : {
        pts: num3(r.stddev_points) ?? 0,
        reb: num3(r.stddev_rebounds) ?? 0,
        ast: num3(r.stddev_assists) ?? 0,
        stl: num3(r.stddev_steals) ?? 0,
        blk: num3(r.stddev_blocks) ?? 0,
      }

const mapPctiles = (r: SpreadRow): StatPctiles | null =>
  r.pctiles == null
    ? null
    : {
        pts: r.pctiles.points,
        reb: r.pctiles.rebounds,
        ast: r.pctiles.assists,
        stl: r.pctiles.steals,
        blk: r.pctiles.blocks,
      }

// ── league seasons ───────────────────────────────────────────────────────────
interface LeagueRow extends SpreadRow {
  season_year: number
  scheduled_games: number
  avg_points: string | null
  avg_rebounds: string | null
  avg_assists: string | null
  avg_steals: string | null
  avg_blocks: string | null
  avg_fg_pct: string | null
  avg_fg3_pct: string | null
  avg_ts_pct: string | null
  avg_efg_pct: string | null
  avg_tov_pct: string | null
  avg_fg3a_rate: string | null
  avg_ft_rate: string | null
}

/** GET /league — per-year averages + slate length, ascending by year. */
export async function getLeague(pool: Pool): Promise<LeagueSeason[]> {
  const { rows } = await pool.query<LeagueRow>(
    `SELECT season_year, scheduled_games,
            avg_points, avg_rebounds, avg_assists, avg_steals, avg_blocks,
            avg_fg_pct, avg_fg3_pct, avg_ts_pct, avg_efg_pct, avg_tov_pct,
            avg_fg3a_rate, avg_ft_rate, ${SPREAD_COLS}
     FROM league_seasons ORDER BY season_year`,
  )
  return rows.map((r) => ({
    year: r.season_year,
    scheduledGames: r.scheduled_games,
    pts: num3(r.avg_points) ?? 0,
    reb: num3(r.avg_rebounds) ?? 0,
    ast: num3(r.avg_assists) ?? 0,
    stl: num3(r.avg_steals) ?? 0,
    blk: num3(r.avg_blocks) ?? 0,
    fgp: num3(r.avg_fg_pct) ?? 0,
    tpp: num3(r.avg_fg3_pct) ?? 0,
    tsPct: num3(r.avg_ts_pct) ?? 0,
    efgPct: num3(r.avg_efg_pct) ?? 0,
    tovPct: num3(r.avg_tov_pct) ?? 0,
    fg3aRate: num3(r.avg_fg3a_rate) ?? 0,
    ftRate: num3(r.avg_ft_rate) ?? 0,
    stdev: mapStdev(r),
    pctiles: mapPctiles(r),
  }))
}

// ── position seasons ─────────────────────────────────────────────────────────
interface PositionRow extends SpreadRow {
  season_year: number
  position: string
  qualified_players: number
  avg_points: string | null
  avg_rebounds: string | null
  avg_assists: string | null
  avg_steals: string | null
  avg_blocks: string | null
  avg_fg_pct: string | null
  avg_fg3_pct: string | null
  avg_ts_pct: string | null
  avg_efg_pct: string | null
  avg_tov_pct: string | null
  avg_fg3a_rate: string | null
  avg_ft_rate: string | null
}

/** GET /positions — per-year, per-position averages, ascending by year then position.
 *  Thin (year, position) samples are absent (min 8 qualified players; see computePositions). */
export async function getPositions(pool: Pool): Promise<PositionSeason[]> {
  const { rows } = await pool.query<PositionRow>(
    `SELECT season_year, position, qualified_players,
            avg_points, avg_rebounds, avg_assists, avg_steals, avg_blocks,
            avg_fg_pct, avg_fg3_pct, avg_ts_pct, avg_efg_pct, avg_tov_pct,
            avg_fg3a_rate, avg_ft_rate, ${SPREAD_COLS}
     FROM position_seasons ORDER BY season_year, position`,
  )
  return rows.map((r) => ({
    year: r.season_year,
    position: r.position,
    qualifiedPlayers: r.qualified_players,
    pts: num3(r.avg_points) ?? 0,
    reb: num3(r.avg_rebounds) ?? 0,
    ast: num3(r.avg_assists) ?? 0,
    stl: num3(r.avg_steals) ?? 0,
    blk: num3(r.avg_blocks) ?? 0,
    fgp: num3(r.avg_fg_pct) ?? 0,
    tpp: num3(r.avg_fg3_pct) ?? 0,
    tsPct: num3(r.avg_ts_pct) ?? 0,
    efgPct: num3(r.avg_efg_pct) ?? 0,
    tovPct: num3(r.avg_tov_pct) ?? 0,
    fg3aRate: num3(r.avg_fg3a_rate) ?? 0,
    ftRate: num3(r.avg_ft_rate) ?? 0,
    stdev: mapStdev(r),
    pctiles: mapPctiles(r),
  }))
}
