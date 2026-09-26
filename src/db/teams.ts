import type { Pool } from 'pg'
import { upsertReturningId } from './upsert'

/**
 * Insert or update a team by its ESPN id, returning our surrogate id. The teams
 * table is pure franchise identity (names live in team_eras); we just need the
 * row to exist so player_seasons.team_id has something to reference.
 */
export async function upsertTeam(pool: Pool, espnTeamId: string): Promise<string> {
  return upsertReturningId(pool, 'teams', ['espn_id'], { espn_id: espnTeamId })
}

/**
 * Look up a team's surrogate id by ESPN id WITHOUT creating it. Returns null if we
 * have no such team. Used to resolve a bio's "current team" ref: teams are only
 * ever created from real game data (seasons/stints), so a bio pointing at a
 * non-WNBA team (ESPN sometimes lists a departed player's NATIONAL team) finds
 * nothing here and the player's current_team_id is left null — no junk row created.
 */
export async function getTeamIdByEspn(
  pool: Pool,
  espnTeamId: string,
): Promise<string | null> {
  const res = await pool.query(`SELECT id FROM teams WHERE espn_id = $1`, [
    espnTeamId,
  ])
  return res.rows.length ? (res.rows[0] as { id: string }).id : null
}

/** A team with a regular-season row in a season: our surrogate id and ESPN's id. */
export interface SeasonTeam {
  /** OUR teams.id — for joins inside the database. */
  teamId: string
  /** ESPN's id (teams.espn_id) — the only id to send to ESPN. */
  espnId: string
  year: number
}

/**
 * Every team with a regular-season row in a season (or in every season when `year` is omitted):
 * the season's team, plus each stint's team for traded players (stints hang off the season row —
 * they carry no year themselves). Carries BOTH ids because mixing them up is a real bug: until
 * 2026-09-26 the nightly's "Stats through" step sent teams.id to ESPN's schedule endpoint, which
 * reached only 7 of the 15 2026 teams (our 17 is the Mystics, ESPN's 17 the Aces).
 */
export async function seasonTeams(pool: Pool, year?: number): Promise<SeasonTeam[]> {
  const { rows } = await pool.query<{ team_id: string; espn_id: string; season_year: number }>(
    `SELECT DISTINCT t.id::text AS team_id, t.espn_id, x.season_year FROM (
       SELECT team_id, season_year FROM player_seasons
        WHERE season_type = 2 AND team_id IS NOT NULL
       UNION
       SELECT st.team_id, ps.season_year FROM player_season_stints st
         JOIN player_seasons ps ON ps.id = st.season_id
        WHERE ps.season_type = 2
     ) x
     JOIN teams t ON t.id = x.team_id
     WHERE $1::int IS NULL OR x.season_year = $1::int
     ORDER BY x.season_year, team_id`,
    [year ?? null],
  )
  return rows.map((r) => ({ teamId: r.team_id, espnId: r.espn_id, year: r.season_year }))
}
