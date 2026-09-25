import { describe, it, expect } from 'vitest'
import { diffIdentities, diffTeamNames, type Identity, type OpenEra } from './watch'

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

describe('diffTeamNames', () => {
  const eras: OpenEra[] = [
    { espnId: '18', name: 'Connecticut Sun', abbreviation: 'CON' },
    { espnId: '17', name: 'Las Vegas Aces', abbreviation: 'LV' },
  ]
  const espn = (over: Partial<{ espnId: string; name: string; abbreviation: string }>) => ({
    espnId: '18',
    name: 'Connecticut Sun',
    abbreviation: 'CON',
    ...over,
  })

  it('is silent when every current team matches its open era', () => {
    expect(diffTeamNames([espn({}), espn({ espnId: '17', name: 'Las Vegas Aces', abbreviation: 'LV' })], eras)).toEqual([])
  })

  it('flags a relocation that kept the franchise id (the Sun → Houston case)', () => {
    const out = diffTeamNames([espn({ name: 'Houston Comets', abbreviation: 'HOU' })], eras)
    expect(out).toEqual([
      { espnId: '18', espnName: 'Houston Comets', espnAbbreviation: 'HOU', eraName: 'Connecticut Sun', eraAbbreviation: 'CON' },
    ])
  })

  it('ignores an abbreviation-only difference (ESPN endpoints disagree: PHX vs PHO)', () => {
    expect(diffTeamNames([espn({ espnId: '17', name: 'Las Vegas Aces', abbreviation: 'LVA' })], eras)).toEqual([])
  })

  it('reports an ESPN team with no open era at all (a revived id, before any season exists)', () => {
    const out = diffTeamNames([espn({ espnId: '4', name: 'Houston Comets', abbreviation: 'HOU' })], eras)
    expect(out).toEqual([{ espnId: '4', espnName: 'Houston Comets', espnAbbreviation: 'HOU', eraName: null, eraAbbreviation: null }])
  })

  it('ignores open eras ESPN no longer lists (nothing to rename)', () => {
    expect(diffTeamNames([espn({})], eras)).toEqual([]) // Aces open era present, absent from ESPN's list
  })
})
