import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTeamGames } from './client'

/** A core team-statistics response carrying only gamesPlayed, shaped like ESPN's. */
const teamStats = (gamesPlayed: number) =>
  new Response(JSON.stringify({ splits: { categories: [{ name: 'general', stats: [{ name: 'gamesPlayed', value: gamesPlayed }] }] } }))

describe('fetchTeamGames', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reads ESPN's team-statistics gamesPlayed for a finished season", async () => {
    const fetch = vi.fn(async () => teamStats(32))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchTeamGames('6', 2001)).toEqual({ games: 32, source: 'team_stats' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('a hand-checked correction wins over ESPN, without asking (2002 Lynx: ESPN 31, played 32)', async () => {
    const fetch = vi.fn(async () => teamStats(31))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchTeamGames('8', 2002)).toEqual({ games: 32, source: 'correction' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('null when ESPN has no statistics for the team that year (the caller falls back to the season total)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    expect(await fetchTeamGames('4', 2008)).toBeNull()
  })
})
