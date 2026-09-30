import { describe, it, expect } from 'vitest'
import { POSITION_OVERRIDES, storedPosition } from './positionOverrides'

describe('storedPosition', () => {
  it('fills in a hand-read position only where ESPN has none', () => {
    expect(storedPosition({ espnId: '289', position: null })).toBe('C') // Chasity Melvin
    expect(storedPosition({ espnId: '289', position: 'F' })).toBe('F') // ESPN's own wins
    expect(storedPosition({ espnId: '1627668', position: null })).toBeNull() // no entry
  })

  it('every entry is one of the three letters ESPN stores, with a source', () => {
    for (const [espnId, o] of Object.entries(POSITION_OVERRIDES)) {
      expect(['G', 'F', 'C'], espnId).toContain(o.position)
      expect(o.source.length, espnId).toBeGreaterThan(0)
    }
    expect(Object.keys(POSITION_OVERRIDES)).toHaveLength(46)
  })
})
