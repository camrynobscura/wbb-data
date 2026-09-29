/**
 * The query layer: each function takes a pg Pool and returns the API contract types. The Express routes
 * are thin wrappers over these; no SQL or shaping lives in the HTTP layer.
 *
 * Two pg gotchas handled here:
 *  - bigint columns (ids) come back as strings — already what the contract wants.
 *  - numeric columns (minutes, all rate stats) come back as STRINGS to preserve
 *    precision — we Number() them.
 */
import type { Pool } from 'pg'
import { FULL_SCHEDULE_GAMES, QUALIFYING_GAMES } from '../db/computeLeague'
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
const perGame = (total: number, gp: number): number => Math.round((total / gp) * 10) / 10
/** made/att as a decimal to 3 places; null when there were no attempts. */
const ratio = (made: number, att: number): number | null => (att > 0 ? Math.round((made / att) * 1000) / 1000 : null)
/** A pg numeric (string | null) → number to 3 places, or null. */
const num3 = (v: unknown): number | null => (v == null ? null : Math.round(Number(v) * 1000) / 1000)

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
 * GET /players, alphabetical. `current` (the default) is the rolling window: anyone with a season, regular
 * or playoff, in the last ROSTER_WINDOW_YEARS years. `all` is every player in the database, retired
 * included.
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
  team_games: number
  minutes: string | null
  points: number
  fg_made: number
  fg_att: number
  fg3_made: number
  fg3_att: number
  ft_made: number
  ft_att: number
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
  // The shooting percentages: each ranks only among the qualified seasons that ALSO cleared its
  // rank floor (RATE_RANK_FLOOR, scaled to the team's games) AND its color floor (RATE_TINT_FLOOR), so each
  // has its own pool. The rank is null when this season is under either; the pool is the year's
  // count regardless.
  pool_fgp: string
  pool_tpp: string
  pool_ts: string
  r_fgp: string | null
  r_tpp: string | null
  r_ts: string | null
  // …and among the player's position (null when fewer than MIN_QUALIFIED of them cleared the
  // floor, or when there is no position bucket at all).
  pos_pool_fgp: string | null
  pos_pool_tpp: string | null
  pos_pool_ts: string | null
  p_fgp: string | null
  p_tpp: string | null
  p_ts: string | null
}

/**
 * Rank floors for a shooting percentage, per FULL_SCHEDULE_GAMES-game season and scaled to the
 * player's team's games in the SQL (count × 44 >= floor × team games). A season clears it with enough attempts
 * or enough makes: 3P% 60 attempts or 20 made; FG% 200 attempts or 85 made;
 * TS% 125 "shooting possessions" (FGA + 0.44 × FTA, the TS% denominator — already attempts).
 * The made counts are Basketball-Reference's WNBA rate-stat requirements; the attempt counts are
 * the same bar at the league's all-time average (33.9% from three → 20 made ≈ 59 attempts; 43.1%
 * FG → 85 made ≈ 197), added so a high-volume shooter who misses a lot is still ranked (a makes-only
 * floor left Kia Nurse's 69-of-207 out) without dropping an efficient low-volume one (an
 * attempts-only floor left Makayla Timpson's 100-of-156 out). Measured: the "or" rule only adds —
 * +133 3P% and +126 FG% seasons since 1997, none dropped. Without floors a 4-of-10 season leads the
 * league at 40% (2023: Aliyah Boston). The frontend mirrors the numbers (deviation.ts RANK_FLOOR)
 * only to word "Needs 55 attempts from three or 19 made to rank" — keep them paired.
 */
export const RATE_RANK_FLOOR = { fgAtt: 200, fgMade: 85, fg3Att: 60, fg3Made: 20, tsPossessions: 125 } as const

/**
 * The frontend's color floors (deviation.ts TINT_FLOOR; keep them paired), fixed counts, not scaled: a
 * season under one shows that cell hollow. The rank pool requires them too, so a ranked season is always
 * a colored one. The scaled rank floors dip below these in short seasons: in the 22-game 2020 bubble,
 * 25 3P% seasons (Dearica Hamby 18-of-38) and 3 FG% seasons would otherwise be ranked and counted in
 * everyone's "of N" while their cells were hollow.
 */
export const RATE_TINT_FLOOR = { fgAtt: 100, fg3Att: 40, tsPossessions: 100 } as const

// Where each of a player's seasons ranks among that year's QUALIFIED player-seasons — the same pool
// computeLeague.ts averages over (QUALIFYING_GAMES of FULL_SCHEDULE_GAMES, scaled to the player's
// team's games, player_season_team_games), so the rank and the averages describe the same crowd. One window
// pass over the player's years only; the player's own rows are then picked out. A season that doesn't
// qualify gets no row here: rank null, pool still known.
// A second set of windows partitions by position — the same crowd computePositions.ts averages
// over, gated the same two ways so a position rank exists only where the position average does:
// the bucket has >= $4 (MIN_QUALIFIED) players, AND the season is position-complete — every
// qualified player that year has a position (league_seasons.qualified_with_position =
// qualified_players, migration 005; ESPN has no position for most pre-2012 players). The
// completeness check lives in pos_pools, so an incomplete year simply has no position pool.
// The three shooting percentages get the same treatment with two more gates each: a season ranks
// only if it also cleared that stat's rank floor (RATE_RANK_FLOOR, $5–$9, attempts OR makes, scaled
// to the team's games) AND its color floor (RATE_TINT_FLOOR, $10–$12, fixed), and its pool is the count
// that cleared both — so "4th of 69" for 3P% and "3rd of 122" for points sit side by side with
// different, honest denominators, and no hollow cell is ever counted.
const RANK_SQL = `
WITH seasons AS (
  -- Each regular-season row in the player's years, with its games bar: the player's OWN team's
  -- games (player_season_team_games, migration 008 — the last team for a traded player), falling
  -- back to the season total for a team with no row yet. The same Y the page prints.
  SELECT ps.*, p.position,
         COALESCE(v.team_games, ls.scheduled_games) AS team_games,
         (ls.qualified_with_position = ls.qualified_players) AS pos_complete
  FROM player_seasons ps
  JOIN players p         ON p.id = ps.player_id
  JOIN league_seasons ls ON ls.season_year = ps.season_year
  LEFT JOIN player_season_team_games v ON v.season_id = ps.id
  WHERE ps.season_type = 2
    AND ps.season_year IN (SELECT season_year FROM player_seasons WHERE player_id = $1 AND season_type = 2)
),
pool AS (
  SELECT s.player_id, s.season_year, s.games_played, s.position, s.team_games,
         s.points, s.rebounds, s.assists, s.steals, s.blocks,
         s.fg_made, s.fg_att, s.fg3_made, s.fg3_att, s.ft_att, s.ts_pct,
         s.pos_complete,
         -- Cleared this stat's rank floor (attempts OR makes, scaled to the team's games, integer
         -- arithmetic) AND its fixed color floor, so every ranked season is a colored one.
         ((s.fg_att * $3::int >= $5::int * s.team_games OR s.fg_made * $3::int >= $6::int * s.team_games)
           AND s.fg_att >= $10::int)                                                  AS ok_fgp,
         ((s.fg3_att * $3::int >= $7::int * s.team_games OR s.fg3_made * $3::int >= $8::int * s.team_games)
           AND s.fg3_att >= $11::int)                                                 AS ok_tpp,
         ((s.fg_att + 0.44 * s.ft_att) * $3::int >= $9::int * s.team_games
           AND (s.fg_att + 0.44 * s.ft_att) >= $12::int)                              AS ok_ts
  FROM seasons s
  WHERE s.games_played * $3::int >= $2::int * s.team_games
),
ranked AS (
  SELECT player_id, season_year,
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
-- The shooting percentages rank only among the seasons over that stat's floor: one window pass
-- each over the seasons that cleared it, league-wide and within the position.
rate_fgp AS (
  SELECT player_id, season_year,
         RANK() OVER (PARTITION BY season_year ORDER BY fg_made::numeric / fg_att DESC) AS r,
         RANK() OVER (PARTITION BY season_year, position ORDER BY fg_made::numeric / fg_att DESC) AS pr
  FROM pool WHERE ok_fgp
),
rate_tpp AS (
  SELECT player_id, season_year,
         RANK() OVER (PARTITION BY season_year ORDER BY fg3_made::numeric / fg3_att DESC) AS r,
         RANK() OVER (PARTITION BY season_year, position ORDER BY fg3_made::numeric / fg3_att DESC) AS pr
  FROM pool WHERE ok_tpp
),
rate_ts AS (
  SELECT player_id, season_year,
         RANK() OVER (PARTITION BY season_year ORDER BY ts_pct DESC) AS r,
         RANK() OVER (PARTITION BY season_year, position ORDER BY ts_pct DESC) AS pr
  FROM pool WHERE ok_ts
),
pools AS (
  SELECT season_year, COUNT(*) AS pool,
         COUNT(*) FILTER (WHERE ok_fgp) AS pool_fgp,
         COUNT(*) FILTER (WHERE ok_tpp) AS pool_tpp,
         COUNT(*) FILTER (WHERE ok_ts)  AS pool_ts
  FROM pool GROUP BY season_year
),
pos_pools AS (
  SELECT season_year, COUNT(*) AS pos_pool,
         COUNT(*) FILTER (WHERE ok_fgp) AS pos_pool_fgp,
         COUNT(*) FILTER (WHERE ok_tpp) AS pos_pool_tpp,
         COUNT(*) FILTER (WHERE ok_ts)  AS pos_pool_ts
  FROM pool
  WHERE position = (SELECT position FROM players WHERE id = $1) AND pos_complete
  GROUP BY season_year
)
SELECT p.season_year, p.pool, p.pool_fgp, p.pool_tpp, p.pool_ts,
       r.r_pts, r.r_reb, r.r_ast, r.r_stl, r.r_blk,
       f.r AS r_fgp, t.r AS r_tpp, s.r AS r_ts,
       CASE WHEN pp.pos_pool >= $4::int THEN pp.pos_pool END AS pos_pool,
       CASE WHEN pp.pos_pool >= $4::int THEN r.p_pts END AS p_pts,
       CASE WHEN pp.pos_pool >= $4::int THEN r.p_reb END AS p_reb,
       CASE WHEN pp.pos_pool >= $4::int THEN r.p_ast END AS p_ast,
       CASE WHEN pp.pos_pool >= $4::int THEN r.p_stl END AS p_stl,
       CASE WHEN pp.pos_pool >= $4::int THEN r.p_blk END AS p_blk,
       -- A position rank for a percentage needs MIN_QUALIFIED of the position over the floor too,
       -- so "1st of 3 centers" never appears.
       CASE WHEN pp.pos_pool_fgp >= $4::int THEN pp.pos_pool_fgp END AS pos_pool_fgp,
       CASE WHEN pp.pos_pool_tpp >= $4::int THEN pp.pos_pool_tpp END AS pos_pool_tpp,
       CASE WHEN pp.pos_pool_ts  >= $4::int THEN pp.pos_pool_ts  END AS pos_pool_ts,
       CASE WHEN pp.pos_pool_fgp >= $4::int THEN f.pr END AS p_fgp,
       CASE WHEN pp.pos_pool_tpp >= $4::int THEN t.pr END AS p_tpp,
       CASE WHEN pp.pos_pool_ts  >= $4::int THEN s.pr END AS p_ts
FROM pools p
LEFT JOIN ranked r     ON r.season_year = p.season_year AND r.player_id = $1
LEFT JOIN rate_fgp f   ON f.season_year = p.season_year AND f.player_id = $1
LEFT JOIN rate_tpp t   ON t.season_year = p.season_year AND t.player_id = $1
LEFT JOIN rate_ts s    ON s.season_year = p.season_year AND s.player_id = $1
LEFT JOIN pos_pools pp ON pp.season_year = p.season_year
ORDER BY p.season_year`

function toSeasonPlayed(r: SeasonRow, birthYear: number | null, rk: RankRow | undefined): SeasonPlayed {
  const gp = r.games_played
  const opt = (v: string | null): number | null => (v == null ? null : Number(v))
  const rank =
    rk && rk.r_pts != null
      ? {
          pts: Number(rk.r_pts),
          reb: Number(rk.r_reb),
          ast: Number(rk.r_ast),
          stl: Number(rk.r_stl),
          blk: Number(rk.r_blk),
          fgp: opt(rk.r_fgp),
          tpp: opt(rk.r_tpp),
          tsPct: opt(rk.r_ts),
        }
      : null
  const posRank =
    rk && rk.p_pts != null
      ? {
          pts: Number(rk.p_pts),
          reb: Number(rk.p_reb),
          ast: Number(rk.p_ast),
          stl: Number(rk.p_stl),
          blk: Number(rk.p_blk),
          fgp: opt(rk.p_fgp),
          tpp: opt(rk.p_tpp),
          tsPct: opt(rk.p_ts),
        }
      : null
  return {
    year: r.season_year,
    played: true,
    age: birthYear === null ? null : r.season_year - birthYear,
    gp,
    teamGames: r.team_games,
    pool: rk ? Number(rk.pool) : null,
    rank,
    ratePool: rk ? { fgp: Number(rk.pool_fgp), tpp: Number(rk.pool_tpp), tsPct: Number(rk.pool_ts) } : null,
    posPool: rk && rk.pos_pool != null ? Number(rk.pos_pool) : null,
    posRank,
    posRatePool:
      rk && rk.pos_pool != null
        ? { fgp: opt(rk.pos_pool_fgp), tpp: opt(rk.pos_pool_tpp), tsPct: opt(rk.pos_pool_ts) }
        : null,
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
    ftMade: r.ft_made,
    ftAtt: r.ft_att,
    ptsTotal: r.points,
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

  // team_games: the player's team's games that season (player_season_team_games, migration 008),
  // else the season total — the same Y the rank query and the averages use. The last fallback,
  // games_played, only answers for a year compute-league hasn't reached yet.
  const seasonRes = await pool.query<SeasonRow>(
    `SELECT ps.season_year, ps.games_played, ps.minutes, ps.points, ps.fg_made, ps.fg_att,
            ps.fg3_made, ps.fg3_att, ps.ft_made, ps.ft_att, ps.rebounds, ps.assists, ps.steals, ps.blocks,
            ps.ts_pct, ps.efg_pct, ps.tov_pct, ps.fg3a_rate, ps.ft_rate, ps.usg_pct, ps.ast_pct,
            ps.oreb_pct, ps.dreb_pct, ps.treb_pct,
            COALESCE(v.team_games, ls.scheduled_games, ps.games_played) AS team_games
     FROM player_seasons ps
     LEFT JOIN player_season_team_games v ON v.season_id = ps.id
     LEFT JOIN league_seasons ls ON ls.season_year = ps.season_year
     WHERE ps.player_id = $1 AND ps.season_type = 2
     ORDER BY ps.season_year`,
    [id],
  )
  const rankRes = await pool.query<RankRow>(RANK_SQL, [
    id,
    QUALIFYING_GAMES,
    FULL_SCHEDULE_GAMES,
    MIN_QUALIFIED,
    RATE_RANK_FLOOR.fgAtt,
    RATE_RANK_FLOOR.fgMade,
    RATE_RANK_FLOOR.fg3Att,
    RATE_RANK_FLOOR.fg3Made,
    RATE_RANK_FLOOR.tsPossessions,
    RATE_TINT_FLOOR.fgAtt,
    RATE_TINT_FLOOR.fg3Att,
    RATE_TINT_FLOOR.tsPossessions,
  ])
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
