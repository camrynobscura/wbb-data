import { describe, it, expect } from 'vitest'
import { diffIdentities, type Identity } from './watch'

const mk = (o: Partial<Identity>): Identity => ({
  espnId: 'x',
  name: 'Player',
  position: 'G',
  team: 'Team A',
  ...o,
})

describe('diffIdentities', () => {
  it('reports a team change (the common case: a trade)', () => {
    const before = new Map([['1', mk({ espnId: '1', team: 'Indiana Fever' })]])
    const after = new Map([['1', mk({ espnId: '1', team: 'Las Vegas Aces' })]])
    const changes = diffIdentities(before, after)
    expect(changes).toEqual([
      {
        espnId: '1',
        name: 'Player',
        fields: [{ field: 'team', from: 'Indiana Fever', to: 'Las Vegas Aces' }],
      },
    ])
  })

  it('reports multiple changed fields for one player', () => {
    const before = new Map([['1', mk({ espnId: '1', name: 'Old', position: 'G' })]])
    const after = new Map([['1', mk({ espnId: '1', name: 'New', position: 'F' })]])
    const [change] = diffIdentities(before, after)
    expect(change?.fields.map((f) => f.field)).toEqual(['name', 'position'])
  })

  it('is silent when nothing changed', () => {
    const snap = new Map([['1', mk({ espnId: '1' })]])
    expect(diffIdentities(snap, snap)).toEqual([])
  })

  it('skips a player absent from the before-snapshot (nothing to compare)', () => {
    const before = new Map<string, Identity>()
    const after = new Map([['1', mk({ espnId: '1', team: 'Team B' })]])
    expect(diffIdentities(before, after)).toEqual([])
  })

  it('treats a null → value team as a change (team name became resolvable)', () => {
    const before = new Map([['1', mk({ espnId: '1', team: null })]])
    const after = new Map([['1', mk({ espnId: '1', team: 'Toronto Tempo' })]])
    const [change] = diffIdentities(before, after)
    expect(change?.fields).toEqual([{ field: 'team', from: null, to: 'Toronto Tempo' }])
  })
})
