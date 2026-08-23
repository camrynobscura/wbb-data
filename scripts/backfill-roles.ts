/**
 * 2nd pass: backfill exact minutes for every season, and USG%/AST% for
 * single-team seasons. Traded TOTAL rows get minutes only — usage/assist rate
 * against a single team's totals isn't well-defined across two teams, so those
 * stay null for v1. Rebound %s stay null (ESPN has no opponent rebounds).
 *
 * Run with:  npx tsx scripts/backfill-roles.ts
 */
process.loadEnvFile()

import { Pool } from 'pg'
import { fetchTeamTotals, fetchPlayerMinutes, type TeamTotals } from '../src/espn/client'
import { usageRate, assistRate } from '../src/stats/roleRates'

const CONCURRENCY = 6

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      if (item !== undefined) await worker(item)
    }
  })
  await Promise.all(runners)
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows } = await pool.query(`
    SELECT ps.id, ps.season_year, ps.season_type, ps.is_total_row,
           ps.fg_att, ps.fg_made, ps.ft_att, ps.assists, ps.turnovers,
           p.espn_id AS player_espn, t.espn_id AS team_espn
    FROM player_seasons ps
    JOIN players p ON p.id = ps.player_id
    LEFT JOIN teams t ON t.id = ps.team_id
  `)
  console.log(`backfilling ${rows.length} seasons (concurrency ${CONCURRENCY})...`)

  // Cache team totals by (team, year, type) — many players share each.
  const teamCache = new Map<string, TeamTotals | null>()
  const getTeamTotals = async (teamEspn: string, year: number, type: number) => {
    const key = `${teamEspn}|${year}|${type}`
    if (!teamCache.has(key)) {
      teamCache.set(key, await fetchTeamTotals(teamEspn, year, type))
    }
    return teamCache.get(key) ?? null
  }

  let done = 0
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
      const team = await getTeamTotals(row.team_espn, row.season_year, row.season_type)
      if (team) {
        const teamMinutes = team.games * 200
        usg = usageRate({
          fga: row.fg_att, fta: row.ft_att, tov: row.turnovers, minutes,
          teamFga: team.fga, teamFta: team.fta, teamTov: team.tov, teamMinutes,
        })
        ast = assistRate({
          assists: row.assists, fgMade: row.fg_made, minutes,
          teamFgMade: team.fgMade, teamMinutes,
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

    done++
    if (done % 200 === 0) console.log(`  ${done}/${rows.length}`)
  })

  console.log(`✅ backfill done: ${done} seasons, ${rolesFilled} with role rates`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
