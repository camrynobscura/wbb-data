/**
 * Shared SQL for the decile ladders (migration 004), used by computeLeague and computePositions so league
 * and position rows are built the same way: 11 values at the 0th, 10th, …, 100th percentiles of a per-game
 * stat across that season's qualified players. Served in /league and /positions; the current frontend
 * doesn't read them.
 */

// Decile fractions for percentile_cont's multi-percentile (array) form.
const PCTL_FRACTIONS = 'ARRAY[0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]::float8[]'

/**
 * SQL for the value-at-decile ladder of a per-game expression, rounded to 3 decimals and
 * boxed as a jsonb number array. `expr` must evaluate to float8 (cast integer counting
 * columns yourself, e.g. `points::float8 / games_played`) — percentile_cont's ordered input
 * must be double precision.
 */
export const pctlLadder = (expr: string): string =>
  `to_jsonb((percentile_cont(${PCTL_FRACTIONS}) WITHIN GROUP (ORDER BY ${expr}))::numeric(12,3)[])`
