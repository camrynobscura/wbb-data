import { describe, it, expect } from 'vitest'
import { usageRate, assistRate } from './roleRates'

describe('usageRate', () => {
  it("matches A'ja Wilson's validated 2024 usage (~32.1%)", () => {
    const usg = usageRate({
      fga: 743,
      fta: 275,
      tov: 48,
      minutes: 1308,
      teamFga: 2724,
      teamFta: 733,
      teamTov: 432,
      teamMinutes: 40 * 200, // 40 games
    })
    expect(usg).toBeCloseTo(32.1, 1)
  })

  it('returns null when the player has 0 minutes', () => {
    expect(
      usageRate({
        fga: 0, fta: 0, tov: 0, minutes: 0,
        teamFga: 2724, teamFta: 733, teamTov: 432, teamMinutes: 8000,
      }),
    ).toBeNull()
  })
})

describe('assistRate', () => {
  it('computes a hand-checked value', () => {
    // onCourt = 1000 / (8000/5) = 0.625; denom = 0.625*1000 - 200 = 425; 100*100/425 = 23.53
    const ast = assistRate({
      assists: 100,
      fgMade: 200,
      minutes: 1000,
      teamFgMade: 1000,
      teamMinutes: 8000,
    })
    expect(ast).toBeCloseTo(23.53, 1)
  })

  it('returns null when the denominator is 0', () => {
    expect(
      assistRate({
        assists: 10, fgMade: 100, minutes: 800, teamFgMade: 200, teamMinutes: 8000,
      }),
    ).toBeNull() // onCourt 0.5 * 200 - 100 = 0
  })
})
