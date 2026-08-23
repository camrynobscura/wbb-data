/**
 * Role-rate formulas (USG%, AST%) — pure math over a player's season totals and
 * their team's season totals. No network, no DB. Rebound %s are intentionally
 * absent: they need opponent rebounds, which ESPN doesn't expose per team.
 *
 * teamMinutes here is total team player-minutes = games × 200 (WNBA: 40-min
 * games × 5 players). So teamMinutes / 5 = games × 40 = the team's "team-minutes"
 * (the minutes figure the standard formulas use).
 */

export interface UsageInputs {
  fga: number
  fta: number
  tov: number
  minutes: number // player minutes played
  teamFga: number
  teamFta: number
  teamTov: number // the player-attributable `turnovers` field, not totalTurnovers
  teamMinutes: number
}

/**
 * Usage rate: share of team plays a player "used" while on court.
 * USG% = 100 · ((FGA + 0.44·FTA + TOV) · (TmMP/5)) / (MP · (TmFGA + 0.44·TmFTA + TmTOV))
 * Returns null when the denominator is 0 (e.g. a player with 0 minutes).
 */
export function usageRate(i: UsageInputs): number | null {
  const denom = i.minutes * (i.teamFga + 0.44 * i.teamFta + i.teamTov)
  if (denom === 0) {
    return null
  }
  const playerPlays = i.fga + 0.44 * i.fta + i.tov
  return (100 * playerPlays * (i.teamMinutes / 5)) / denom
}

export interface AssistInputs {
  assists: number
  fgMade: number
  minutes: number
  teamFgMade: number
  teamMinutes: number
}

/**
 * Assist rate: share of teammates' made field goals a player assisted while on court.
 * AST% = 100 · AST / (((MP / (TmMP/5)) · TmFG) − FG)
 * Returns null when the denominator is 0.
 */
export function assistRate(i: AssistInputs): number | null {
  const onCourtFraction = i.minutes / (i.teamMinutes / 5)
  const denom = onCourtFraction * i.teamFgMade - i.fgMade
  if (denom === 0) {
    return null
  }
  return (100 * i.assists) / denom
}
