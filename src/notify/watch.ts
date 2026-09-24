import type { Pool } from 'pg'

/**
 * The featured players the frontend hard-codes on its landing page, by ESPN id.
 * MIRROR of wnba-arc/src/data/featured.ts — keep the two id lists in sync (ids are
 * permanent, so this rarely changes). We store only ids: the refresh compares each
 * player's identity in the DB from one run to the next, so it needs no baked
 * name/team values here (that's the "change-at-scrape" detection — see DECISIONS).
 */
export const FEATURED_ESPN_IDS: string[] = [
  '3149391', // A'ja Wilson
  '2998928', // Breanna Stewart
  '4433730', // Paige Bueckers
  '4433403', // Caitlin Clark
  '4433791', // Olivia Miles
  '3142328', // Gabby Williams
  '4433402', // Angel Reese
  '3917450', // Napheesa Collier
  '1068', // Nneka Ogwumike
  '4433524', // Sonia Citron
  '3142191', // Kelsey Mitchell
  '3904576', // Marina Mabrey
  '3906949', // Jessica Shepard
  '2529140', // Alyssa Thomas
  '3065570', // Kelsey Plum
  '4066533', // Sabrina Ionescu
  '4433405', // Kamilla Cardoso
  '2490553', // Brittney Griner
  '4398729', // Emily Engstler
  '5220150', // Dominique Malonga
]

/** One featured player's identity as the DB currently sees it. */
export interface Identity {
  espnId: string
  name: string
  position: string | null
  team: string | null
}

/** A single field that moved between two runs, for the alert message. */
export interface IdentityChange {
  espnId: string
  name: string
  fields: { field: 'name' | 'position' | 'team'; from: string | null; to: string | null }[]
}

/**
 * Read the current DB identity (name, position, era-correct current team) for the
 * given ESPN ids. Returned as a map keyed by espnId for easy before/after diffing.
 */
export async function snapshotIdentities(
  pool: Pool,
  espnIds: string[],
): Promise<Map<string, Identity>> {
  const { rows } = await pool.query(
    `SELECT p.espn_id, p.name, p.position, pct.team_name
       FROM players p
       LEFT JOIN player_current_team pct ON pct.player_id = p.id
      WHERE p.espn_id = ANY($1)`,
    [espnIds],
  )
  const map = new Map<string, Identity>()
  for (const r of rows) {
    map.set(r.espn_id, {
      espnId: r.espn_id,
      name: r.name,
      position: r.position,
      team: r.team_name,
    })
  }
  return map
}

/**
 * Compare two identity snapshots and return one entry per player whose name,
 * position, or team changed. A player missing from `before` (e.g. just added to
 * the watch list, or first ever ingest) is skipped — there's no "from" to compare.
 */
export function diffIdentities(
  before: Map<string, Identity>,
  after: Map<string, Identity>,
): IdentityChange[] {
  const changes: IdentityChange[] = []
  for (const [espnId, now] of after) {
    const was = before.get(espnId)
    if (!was) continue
    const fields: IdentityChange['fields'] = []
    if (was.name !== now.name) fields.push({ field: 'name', from: was.name, to: now.name })
    if (was.position !== now.position)
      fields.push({ field: 'position', from: was.position, to: now.position })
    if (was.team !== now.team) fields.push({ field: 'team', from: was.team, to: now.team })
    if (fields.length > 0) changes.push({ espnId, name: now.name, fields })
  }
  return changes
}

/**
 * Teams with game data that no era NAMES — a player season (or stint) in a year that no
 * team_eras row covers. That is exactly the set seed-team-eras can and should name: a genuinely
 * new WNBA franchise once it starts playing (no era at all), or a revived id playing a season past
 * its last era (Portland's 132052 in 2026 without a 2026 era).
 *
 * NOT "no current era" (an era with end_year IS NULL), which this checked until 2026-09-24: that
 * was only right while every team in the database was a current one. The full-history ingest
 * added the retired franchises — Comets, Sting, Rockers, Sol, Miracle, Starzz, Monarchs — whose
 * eras all end, and they tripped the check every night although each was fully named.
 *
 * The game-data requirement is deliberate: ESPN bios sometimes point an international player's
 * "current team" at her NATIONAL team (Brazil, Nigeria), which upsertTeam then creates as a bare
 * teams row. Those have no season data, seed-team-eras can never name them, so flagging them
 * would be a nightly false alarm. Returns the ESPN ids to name.
 */
export async function findUnnamedTeams(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT t.espn_id
       FROM teams t
       JOIN (
              SELECT team_id, season_year FROM player_seasons WHERE team_id IS NOT NULL
              UNION
              SELECT st.team_id, ps.season_year
                FROM player_season_stints st
                JOIN player_seasons ps ON ps.id = st.season_id
            ) s ON s.team_id = t.id
      WHERE NOT EXISTS (
              SELECT 1 FROM team_eras te
               WHERE te.team_id = t.id
                 AND te.start_year <= s.season_year
                 AND (te.end_year IS NULL OR te.end_year >= s.season_year)
            )
      ORDER BY t.espn_id`,
  )
  return rows.map((r) => r.espn_id)
}
