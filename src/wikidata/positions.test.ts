import { describe, it, expect } from 'vitest'
import type { Entity } from './client'
import {
  assess,
  candidateFacts,
  judge,
  nameVariants,
  normalizeName,
  positionLetters,
  articleEvidence,
  infoboxPosition,
  positionSentence,
  withArticle,
  wnbaUrl,
  type OurPlayer,
} from './positions'

const item = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } })
const time = (t: string, precision = 11) => ({ datavalue: { value: { time: t, precision } } })

// Kerri Gardin as Wikidata holds her (2026-09-30): the Sun and the Mystics, a small forward, a birth date.
const gardin: Entity = {
  id: 'Q3814757',
  labels: { en: { value: 'Kerri Gardin' } },
  descriptions: { en: { value: 'American basketball player (born 1984)' } },
  claims: {
    P31: [item('Q5')],
    P641: [item('Q5372')],
    P413: [item('Q308879')],
    P569: [{ mainsnak: time('+1984-05-19T00:00:00Z') }],
    P54: [item('Q1126243'), item('Q1465192'), item('Q3445798')],
    P3588: [{ mainsnak: { datavalue: { value: 'kerri-gardin' } } }, { mainsnak: { datavalue: { value: '200704' } } }],
  },
}
const labels: Record<string, string> = {
  Q308879: 'small forward',
  Q1126243: 'Connecticut Sun',
  Q1465192: 'Washington Mystics',
  Q3445798: 'ŽKK Jolly JBS',
  Q5372: 'basketball',
}
const labelOf = (id: string) => labels[id] ?? id

const ourGardin: OurPlayer = {
  espn: '721',
  name: 'Kerri Gardin',
  birthDate: null,
  seasons: ['2009 CON', '2010 CON', '2011 WSH'],
  career: ['Connecticut Sun 2009', 'Connecticut Sun 2010', 'Washington Mystics 2011'],
  teams: [
    { names: ['Connecticut Sun'], years: [2009, 2010] },
    { names: ['Washington Mystics'], years: [2011] },
  ],
}

describe('normalizeName', () => {
  it('ignores case, dots, hyphens and accents', () => {
    expect(normalizeName('K.B. Sharp')).toBe('k b sharp')
    expect(normalizeName('Jana Veselá')).toBe('jana vesela')
    expect(normalizeName('San Antonio Silver Stars')).toBe(normalizeName('san antonio silver stars'))
  })
})

describe('nameVariants', () => {
  it('tries the name, then without dots, then each half of a hyphenated surname', () => {
    expect(nameVariants('K.B. Sharp')).toEqual(['K.B. Sharp', 'KB Sharp'])
    expect(nameVariants('Vanessa Hayden-Johnson')).toEqual([
      'Vanessa Hayden-Johnson',
      'Vanessa Hayden',
      'Vanessa Johnson',
    ])
    expect(nameVariants('Lisa Leslie')).toEqual(['Lisa Leslie'])
  })
})

describe('positionLetters', () => {
  it("maps Wikidata's positions to ESPN's letters", () => {
    expect(positionLetters(['point guard'])).toEqual(['G'])
    expect(positionLetters(['shooting guard'])).toEqual(['G'])
    expect(positionLetters(['small forward'])).toEqual(['F'])
    expect(positionLetters(['power forward'])).toEqual(['F'])
    expect(positionLetters(['center'])).toEqual(['C'])
    expect(positionLetters(['centre'])).toEqual(['C'])
  })

  it('gives two letters for a combination, which is for the reviewer', () => {
    expect(positionLetters(['forward-center'])).toEqual(['C', 'F'])
    expect(positionLetters(['small forward', 'shooting guard'])).toEqual(['F', 'G'])
  })

  it('gives nothing for a label that is not a basketball position', () => {
    expect(positionLetters(['sprinter'])).toEqual([])
    expect(positionLetters([])).toEqual([])
  })
})

describe('candidateFacts', () => {
  it('reads the label, sport, birth date, teams with their years and positions', () => {
    const facts = candidateFacts(gardin, labelOf)
    expect(facts).toEqual({
      qid: 'Q3814757',
      label: 'Kerri Gardin',
      description: 'American basketball player (born 1984)',
      human: true,
      basketball: true,
      birthDate: '1984-05-19',
      teams: [
        { label: 'Connecticut Sun', start: null, end: null },
        { label: 'Washington Mystics', start: null, end: null },
        { label: 'ŽKK Jolly JBS', start: null, end: null },
      ],
      positions: ['small forward'],
      wnbaIds: ['kerri-gardin', '200704'],
    })
  })

  it('reads team years from the qualifiers and a year-only birth date', () => {
    const e: Entity = {
      id: 'Q1',
      claims: {
        P569: [{ mainsnak: time('+1972-00-00T00:00:00Z', 9) }],
        P54: [
          {
            ...item('Q1329633'),
            qualifiers: { P580: [time('+1997-00-00T00:00:00Z', 9)], P582: [time('+2009-00-00T00:00:00Z', 9)] },
          },
        ],
      },
    }
    const facts = candidateFacts(e, () => 'Los Angeles Sparks')
    expect(facts.birthDate).toBe('1972')
    expect(facts.teams).toEqual([{ label: 'Los Angeles Sparks', start: 1997, end: 2009 }])
    expect(facts.basketball).toBe(false)
  })
})

describe('assess + judge', () => {
  it('strong: one basketball item shares a team and names one position', () => {
    const report = judge(ourGardin, [assess(ourGardin, candidateFacts(gardin, labelOf))])
    expect(report.verdict).toBe('strong')
    expect(report.position).toBe('F')
    expect(report.source).toBe('wikidata:Q3814757')
    expect(report.why).toBe('Q3814757 lists Connecticut Sun, Washington Mystics and small forward.')
  })

  it('matches any era name of the franchise', () => {
    const player: OurPlayer = {
      ...ourGardin,
      teams: [{ names: ['Detroit Shock', 'Tulsa Shock', 'Dallas Wings'], years: [2010] }],
    }
    const facts = candidateFacts({ ...gardin, claims: { ...gardin.claims, P54: [item('Q2')] } }, (id) =>
      id === 'Q2' ? 'Tulsa Shock' : labelOf(id),
    )
    expect(assess(player, facts).teamMatches).toEqual(['Tulsa Shock'])
  })

  it('a birth date that differs is a contradiction: review, never strong', () => {
    const player = { ...ourGardin, birthDate: '1981-01-01' }
    const report = judge(player, [assess(player, candidateFacts(gardin, labelOf))])
    expect(report.verdict).toBe('review')
    expect(report.why).toBe('Q3814757 born 1984-05-19, ESPN says 1981-01-01.')
  })

  it('a matching birth date is said in the reason', () => {
    const player = { ...ourGardin, birthDate: '1984-05-19' }
    expect(judge(player, [assess(player, candidateFacts(gardin, labelOf))]).why).toContain('birth date matches')
  })

  it('a stint Wikidata knows and ESPN lacks is not a contradiction', () => {
    // Sanni: Wikidata has Detroit 2008–2009, Tulsa 2010, Phoenix 2011; ESPN has no 2010 at all.
    const player: OurPlayer = {
      ...ourGardin,
      teams: [
        { names: ['Detroit Shock', 'Tulsa Shock', 'Dallas Wings'], years: [2008, 2009] },
        { names: ['Phoenix Mercury'], years: [2011] },
      ],
    }
    const window = (id: string, s: string, e: string) => ({
      ...item(id),
      qualifiers: { P580: [time(`+${s}-00-00T00:00:00Z`, 9)], P582: [time(`+${e}-00-00T00:00:00Z`, 9)] },
    })
    const e: Entity = {
      ...gardin,
      claims: {
        ...gardin.claims,
        P54: [window('Q10', '2008', '2009'), window('Q11', '2010', '2010'), window('Q12', '2011', '2011')],
      },
    }
    const names: Record<string, string> = { Q10: 'Detroit Shock', Q11: 'Tulsa Shock', Q12: 'Phoenix Mercury' }
    const c = assess(
      player,
      candidateFacts(e, (id) => names[id] ?? labelOf(id)),
    )
    expect(c.teamMatches).toEqual(['Detroit Shock', 'Tulsa Shock', 'Phoenix Mercury'])
    expect(c.yearsAgree).toBe(true)
    expect(judge(player, [c]).verdict).toBe('strong')
  })

  it("team years that don't cover ours: review", () => {
    const e: Entity = {
      ...gardin,
      claims: {
        ...gardin.claims,
        P54: [
          {
            ...item('Q1126243'),
            qualifiers: { P580: [time('+2015-00-00T00:00:00Z', 9)], P582: [time('+2016-00-00T00:00:00Z', 9)] },
          },
        ],
      },
    }
    const c = assess(ourGardin, candidateFacts(e, labelOf))
    expect(c.yearsAgree).toBe(false)
    const report = judge(ourGardin, [c])
    expect(report.verdict).toBe('review')
    expect(report.why).toBe("Q3814757's years with the team miss every season of ours.")
  })

  it('two positions: review, with both named', () => {
    const e: Entity = { ...gardin, claims: { ...gardin.claims, P413: [item('Q308879'), item('Q9')] } }
    const report = judge(ourGardin, [
      assess(
        ourGardin,
        candidateFacts(e, (id) => (id === 'Q9' ? 'shooting guard' : labelOf(id))),
      ),
    ])
    expect(report.verdict).toBe('review')
    expect(report.why).toContain('small forward and shooting guard (F/G)')
  })

  it('no shared team: review, listing what Wikidata has', () => {
    const e: Entity = { ...gardin, claims: { ...gardin.claims, P54: [item('Q3445798')] } }
    const report = judge(ourGardin, [assess(ourGardin, candidateFacts(e, labelOf))])
    expect(report.verdict).toBe('review')
    expect(report.why).toBe('Q3814757 lists no team of ours (ŽKK Jolly JBS).')
  })

  it('two items that both match a team: review', () => {
    const a = assess(ourGardin, candidateFacts(gardin, labelOf))
    const b = assess(ourGardin, candidateFacts({ ...gardin, id: 'Q99' }, labelOf))
    expect(judge(ourGardin, [a, b]).why).toBe('2 items match a team: Q3814757, Q99.')
  })

  it('none: a matching item with no position', () => {
    const e: Entity = { ...gardin, claims: { ...gardin.claims, P413: [] } }
    const report = judge(ourGardin, [assess(ourGardin, candidateFacts(e, labelOf))])
    expect(report.verdict).toBe('none')
    expect(report.why).toBe('Q3814757 has no position.')
  })

  it('none: an item with no team of ours and no position either', () => {
    const e: Entity = { ...gardin, claims: { ...gardin.claims, P413: [], P54: [item('Q3445798')] } }
    expect(judge(ourGardin, [assess(ourGardin, candidateFacts(e, labelOf))]).verdict).toBe('none')
  })

  it('none: nothing about basketball under the name', () => {
    const e: Entity = { id: 'Q7', descriptions: { en: { value: 'American actress' } }, claims: { P31: [item('Q5')] } }
    expect(judge(ourGardin, [assess(ourGardin, candidateFacts(e, labelOf))]).verdict).toBe('none')
    expect(judge(ourGardin, []).why).toBe('No basketball player found under this name.')
  })

  it('a non-human basketball item (a team, a season) is not a candidate', () => {
    const e: Entity = {
      id: 'Q8',
      descriptions: { en: { value: 'basketball team' } },
      claims: { P31: [item('Q12973')] },
    }
    expect(judge(ourGardin, [assess(ourGardin, candidateFacts(e, labelOf))]).verdict).toBe('none')
  })
})

describe('positionSentence', () => {
  it('quotes the first sentence that names a position, with its letter', () => {
    const text =
      'Chelsea Newton (born February 17, 1983) is an American former professional basketball player. She played guard for the Sacramento Monarchs. She was born in Monroe.'
    expect(positionSentence(text)).toEqual({
      sentence: 'She played guard for the Sacramento Monarchs.',
      letters: ['G'],
    })
  })

  it('reads the compound names and the plural', () => {
    expect(positionSentence('A point guard who later played power forward.')?.letters).toEqual(['F', 'G'])
    expect(positionSentence('One of the best centers of her era.')?.letters).toEqual(['C'])
    expect(positionSentence('She was a forward-center.')?.letters).toEqual(['C', 'F'])
  })

  it('is null when no sentence names a position', () => {
    expect(positionSentence('An American basketball player who won two titles.')).toBeNull()
    expect(positionSentence('')).toBeNull()
  })
})

describe('withArticle', () => {
  const none = judge(ourGardin, [
    assess(ourGardin, candidateFacts({ ...gardin, claims: { ...gardin.claims, P413: [] } }, labelOf)),
  ])
  const article = { title: 'Kerri Gardin', infobox: null, sentence: 'She played forward.', letters: ['F'] as const }

  it('proposes the article letter for a player the rules could not place', () => {
    const r = withArticle(none, { ...article, letters: ['F'] })
    expect(r.verdict).toBe('none')
    expect(r.position).toBe('F')
    expect(r.source).toBe('wikipedia:Kerri Gardin')
    expect(r.wikipedia?.sentence).toBe('She played forward.')
  })

  it('proposes nothing when the article names two positions or none', () => {
    expect(withArticle(none, { ...article, letters: ['C', 'F'] }).position).toBeNull()
    expect(withArticle(none, { ...article, sentence: null, letters: [] }).position).toBeNull()
  })

  it("settles an item's two letters when the article names one of them", () => {
    const two = judge(ourGardin, [
      assess(
        ourGardin,
        candidateFacts({ ...gardin, claims: { ...gardin.claims, P413: [item('Q308879'), item('Q5')] } }, (id) =>
          id === 'Q5' ? 'center' : labelOf(id),
        ),
      ),
    ])
    expect(two.verdict).toBe('review')
    expect(withArticle(two, { ...article, letters: ['C'] }).position).toBe('C')
    expect(withArticle(two, { ...article, letters: ['G'] }).position).toBeNull()
  })

  it('leaves a strong row alone', () => {
    const strong = judge(ourGardin, [assess(ourGardin, candidateFacts(gardin, labelOf))])
    const r = withArticle(strong, { ...article, letters: ['C'] })
    expect(r.position).toBe('F')
    expect(r.source).toBe('wikidata:Q3814757')
  })
})

describe('infoboxPosition + articleEvidence', () => {
  it('reads the infobox field and reduces links and references to text', () => {
    const wikitext =
      '{{Infobox basketball biography\n| name = X\n| position = [[Center (basketball)|Center]] / [[Power forward]]<ref>WNBA.com</ref>\n| height_ft = 6\n}}'
    expect(infoboxPosition(wikitext)).toEqual({ field: 'position', text: 'Center / Power forward' })
    expect(articleEvidence('X', '', wikitext)).toEqual({
      title: 'X',
      infobox: 'position = Center / Power forward',
      sentence: null,
      letters: ['C', 'F'],
    })
  })

  it("a coach's infobox: the playing position is career_position, not the coaching job", () => {
    const wikitext = '| position = Head coach\n| career_position = Guard\n'
    expect(infoboxPosition(wikitext)).toEqual({ field: 'career_position', text: 'Guard' })
    expect(articleEvidence('X', '', '| position = Assistant coach\n').letters).toEqual([])
  })

  it('an empty field on one line does not swallow the next', () => {
    expect(infoboxPosition('| position = | career_position = Power forward / center\n')).toEqual({
      field: 'career_position',
      text: 'Power forward / center',
    })
  })

  it('is null without the field, and the lead sentence decides then', () => {
    expect(infoboxPosition('{{Infobox person\n| name = X\n}}')).toBeNull()
    expect(articleEvidence('X', 'X is a former guard.', '').letters).toEqual(['G'])
  })

  it('an infobox with a position outranks the sentence', () => {
    const e = articleEvidence('X', 'X played guard in college.', '| position = Forward')
    expect(e.letters).toEqual(['F'])
    expect(e.sentence).toBe('X played guard in college.')
  })
})

describe('wnbaUrl', () => {
  it('builds the page address from the number and the slug, or whichever exists', () => {
    expect(wnbaUrl(['kerri-gardin', '200704'])).toBe('https://www.wnba.com/player/200704/kerri-gardin')
    expect(wnbaUrl(['200704'])).toBe('https://www.wnba.com/player/200704/')
    expect(wnbaUrl(['kerri-gardin'])).toBe('https://www.wnba.com/player/kerri-gardin/')
    expect(wnbaUrl([])).toBeNull()
  })
})
