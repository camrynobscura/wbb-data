import { describe, it, expect } from 'vitest'
import { nextFormerNames } from './formerNames'

describe('nextFormerNames', () => {
  it('keeps the name being replaced, after what was already stored', () => {
    expect(nextFormerNames([], 'Nia Coffey', 'Nia Brodie')).toEqual(['Nia Coffey'])
    expect(nextFormerNames(['A One'], 'A Two', 'A Three')).toEqual(['A One', 'A Two'])
  })

  it('changes nothing when the name is the same, or on a first ingest', () => {
    expect(nextFormerNames([], 'Nia Brodie', 'Nia Brodie')).toEqual([])
    expect(nextFormerNames([], null, 'Nia Brodie')).toEqual([])
    expect(nextFormerNames(['Nia Coffey'], 'Nia Brodie', 'Nia Brodie')).toEqual(['Nia Coffey'])
  })

  it('adds the known names once, and never the name the player has now', () => {
    expect(nextFormerNames([], null, 'Nia Brodie', ['Nia Coffey'])).toEqual(['Nia Coffey'])
    expect(nextFormerNames(['Nia Coffey'], 'Nia Brodie', 'Nia Brodie', ['Nia Coffey'])).toEqual(['Nia Coffey'])
    expect(nextFormerNames(['Nia Coffey'], 'Nia Brodie', 'Nia Coffey')).toEqual(['Nia Brodie'])
  })
})
