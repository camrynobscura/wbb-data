/**
 * Shared SQL fragment for the deviation-bar percentile ladders (migration 004), used by both
 * computeLeague and computePositions so league and position rows are built identically.
 *
 * The ladder is DECILES — 11 values at the 0,10,…,100th percentiles of a per-game stat across
 * that season's qualified players. The frontend (wnba-arc deviation.ts) assumes exactly this
 * spacing when it interpolates a player's value back into a percentile, so this spacing is a
 * cross-repo contract: change it here → change it there. Deciles (not a denser ladder) keep
 * the /league and /positions payloads small while still placing near-max values correctly
 * (a star's value sits between the 90th-percentile and the max, and interpolates fine).
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
