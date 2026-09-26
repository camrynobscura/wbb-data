import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTeamGamesPlayed } from './client'

/** A core team-statistics response carrying only gamesPlayed, shaped like ESPN's. */
const teamStats = (gamesPlayed: number) =>
  new Response(JSON.stringify({ splits: { categories: [{ name: 'general', stats: [{ name: 'gamesPlayed', value: gamesPlayed }] }] } }))

describe('fetchTeamGamesPlayed', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reads ESPN's team-statistics gamesPlayed for a finished season", async () => {
    const fetch = vi.fn(async () => teamStats(32))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchTeamGamesPlayed('6', 2001)).toBe(32)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('a hand-checked correction wins over ESPN, without asking (2002 Lynx: ESPN 31, played 32)', async () => {
    const fetch = vi.fn(async () => teamStats(31))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchTeamGamesPlayed('8', 2002)).toBe(32)
    expect(fetch).not.toHaveBeenCalled()
  })
})
