import type { Pool } from 'pg'
import {
  fetchTeamTotals,
  fetchPlayerMinutes,
  type TeamTotals,
} from '../espn/client'
import { usageRate, assistRate } from '../stats/roleRates'
import { mapWithConcurrency } from '../util/concurrency'

const CONCURRENCY = 6

export interface BackfillOptions {
  /**
   * Restrict the backfill to a single season year. Omit to backfill every
   * season (the full-rebuild case). The scheduled refresh passes the current
   * year so it never re-fetches minutes/team-totals for historical seasons,
   * which by definition never change.
   */
  year?: number
  /**
   * Only seasons with no minutes yet — the incremental case after adding players (the
   * full-history build adds ~5,000 seasons beside ~2,100 already filled, which would
   * otherwise all be re-fetched). A season ESPN has no minutes for stays null and is
   * simply re-tried next time: cheap, and the honest answer doesn't change.
   */
  missingOnly?: boolean
}

export interface BackfillResult {
  seasons: number
  rolesFilled: number
}

/**
 * 2nd pass: backfill exact minutes for each season, and USG%/AST% for
 * single-team seasons. Traded TOTAL rows get minutes only — usage/assist rate
 * against a single team's totals isn't well-defined across two teams, so those
 * stay null. Rebound %s stay null (ESPN has no opponent rebounds).
 *
 * Returns counts so callers can log/notify. Does not close the pool.
 */
export async function backfillRoles(
  pool: Pool,
  { year, missingOnly = false }: BackfillOptions = {},
): Promise<BackfillResult> {
  // $1 is the optional year filter: when null the `$1::int IS NULL` branch is
  // always true, so every season is selected; when set, only that year's rows.
  // $2 narrows to seasons still missing minutes when true; false selects them all.
  const { rows } = await pool.query(
    `
    SELECT ps.id, ps.season_year, ps.season_type, ps.is_total_row,
           ps.fg_att, ps.fg_made, ps.ft_att, ps.assists, ps.turnovers,
           p.espn_id AS player_espn, t.espn_id AS team_espn
    FROM player_seasons ps
    JOIN players p ON p.id = ps.player_id
    LEFT JOIN teams t ON t.id = ps.team_id
    WHERE ($1::int IS NULL OR ps.season_year = $1::int)
      AND (NOT $2::boolean OR ps.minutes IS NULL)
  `,
    [year ?? null, missingOnly],
  )

  // Cache team totals by (team, year, type) — many players share each.
  const teamCache = new Map<string, TeamTotals | null>()
  const getTeamTotals = async (teamEspn: string, y: number, type: number) => {
    const key = `${teamEspn}|${y}|${type}`
    if (!teamCache.has(key)) {
      teamCache.set(key, await fetchTeamTotals(teamEspn, y, type))
    }
    return teamCache.get(key) ?? null
  }

  let seasons = 0
  let rolesFilled = 0

  await mapWithConcurrency(rows, CONCURRENCY, async (row) => {
    const minutes = await fetchPlayerMinutes(
      row.player_espn,
      row.season_year,
      row.season_type,
    )

    let usg: number | null = null
    let ast: number | null = null

    if (!row.is_total_row && row.team_espn && minutes) {
      const team = await getTeamTotals(
        row.team_espn,
        row.season_year,
        row.season_type,
      )
      if (team) {
        const teamMinutes = team.games * 200
        usg = usageRate({
          fga: row.fg_att,
          fta: row.ft_att,
          tov: row.turnovers,
          minutes,
          teamFga: team.fga,
          teamFta: team.fta,
          teamTov: team.tov,
          teamMinutes,
        })
        ast = assistRate({
          assists: row.assists,
          fgMade: row.fg_made,
          minutes,
          teamFgMade: team.fgMade,
          teamMinutes,
        })
        if (usg !== null) rolesFilled++
      }
    }

    await pool.query(
      `UPDATE player_seasons
         SET minutes = $2, usg_pct = $3, ast_pct = $4, updated_at = now()
       WHERE id = $1`,
      [row.id, minutes, usg, ast],
    )

    seasons++
  })

  return { seasons, rolesFilled }
}
