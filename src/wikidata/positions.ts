import type { Claim, Entity } from './client'

/**
 * The rules that turn Wikidata items into a position candidate for a player ESPN left unplaced.
 * Pure, so the rules are tested: the position gate is all-or-nothing per season, and one wrong
 * entry would silently change that season's position averages and ranks without anything on the
 * page looking broken. Nothing here decides alone — the output is a candidate file for a person
 * to approve, and "strong" only says the evidence is complete, not that the review can be skipped.
 */

// Wikidata's ids for what we read. P54 "member of sports team" carries the years as qualifiers
// when someone entered them; P413 is "position played on team / speciality".
export const P = {
  instanceOf: 'P31',
  sport: 'P641',
  position: 'P413',
  birthDate: 'P569',
  memberOf: 'P54',
  start: 'P580',
  end: 'P582',
  wnbaId: 'P3588',
} as const
export const HUMAN = 'Q5'
export const BASKETBALL = 'Q5372'

/** ESPN's own vocabulary, the only values `players.position` holds. */
export type Letter = 'G' | 'F' | 'C'

export interface OurTeam {
  /** Every era name of the franchise (Detroit Shock, Tulsa Shock, Dallas Wings) — Wikidata may
      hold the franchise or any one era as the item. */
  names: string[]
  /** The seasons the player was on this team, in our data. */
  years: number[]
}

export interface OurPlayer {
  espn: string
  name: string
  birthDate: string | null
  /** The qualified seasons with no position, as "2009 CON". */
  seasons: string[]
  /** Every season, as "Chicago Sky 2010" — so a reviewer sees why a team matched. */
  career: string[]
  teams: OurTeam[]
}

/** What one Wikidata item says, once its labels are resolved. */
export interface CandidateFacts {
  qid: string
  label: string
  description: string
  human: boolean
  basketball: boolean
  birthDate: string | null
  teams: { label: string; start: number | null; end: number | null }[]
  positions: string[]
  /** WNBA.com's ids for the player (P3588): a number, a name slug, or both — for a link to her page. */
  wnbaIds: string[]
}

export interface Candidate extends CandidateFacts {
  /** Team labels that are one of the player's WNBA teams in our data. */
  teamMatches: string[]
  /** False when Wikidata gives years for a matched team and none of ours fall inside them. */
  yearsAgree: boolean | null
  birth: 'match' | 'mismatch' | 'unknown'
  letters: Letter[]
}

export type Verdict = 'strong' | 'review' | 'none'

/** What the player's Wikipedia article says, fetched for the players Wikidata alone can't place. */
export interface ArticleEvidence {
  title: string
  /** The infobox's playing-position field as "position = Center / power forward", or null when it has none. */
  infobox: string | null
  /** The first sentence of the lead that names a position, or null when none does. */
  sentence: string | null
  /** From the infobox when it has a position, else from the sentence. */
  letters: Letter[]
}

export interface PlayerReport {
  espn: string
  name: string
  born: string | null
  seasons: string[]
  career: string[]
  verdict: Verdict
  /** The position to store: found by the rules when the verdict is strong, proposed from the
      article otherwise; null when nothing found it — the reviewer fills it in. */
  position: Letter | null
  /** "wikidata:Q…" or "wikipedia:<title>" for where the position came from. */
  source: string | null
  why: string
  candidates: Candidate[]
  wikipedia?: ArticleEvidence
}

/** Lower-case letters and digits only, so "K.B. Sharp" and "K. B. Sharp" compare equal. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * The searches to try, in order, until one finds a basketball item: the name as ESPN has it,
 * then without its dots ("KB Sharp" — Wikidata's search reads "K.B." as one word), then each
 * half of a hyphenated surname ("Vanessa Hayden", "Vanessa Johnson" — a married name ESPN has
 * and Wikidata may not, or the reverse).
 */
export function nameVariants(name: string): string[] {
  const out = [name.trim()]
  const noDots = name.replace(/\./g, '').replace(/\s+/g, ' ').trim()
  out.push(noDots)
  const parts = noDots.split(' ')
  const last = parts.at(-1) ?? ''
  if (last.includes('-') && parts.length > 1) {
    for (const half of last.split('-')) out.push([...parts.slice(0, -1), half].join(' '))
  }
  return [...new Set(out.filter(Boolean))]
}

/**
 * Wikidata's position vocabulary → ESPN's letter. Each label's words decide: "point guard" and
 * "shooting guard" are guards, "small forward" and "power forward" are forwards, "center" is a
 * center. A label naming two ("forward-center") or two labels naming different ones give two
 * letters, and that is for the reviewer — ESPN stores exactly one.
 */
export function positionLetters(labels: string[]): Letter[] {
  const letters = new Set<Letter>()
  for (const label of labels) {
    for (const raw of normalizeName(label).split(' ')) {
      const word = raw.replace(/s$/, '')
      if (word === 'guard') letters.add('G')
      else if (word === 'forward') letters.add('F')
      else if (word === 'center' || word === 'centre') letters.add('C')
    }
  }
  return [...letters].sort()
}

function itemId(claim: Claim): string | null {
  const v = claim.mainsnak.datavalue?.value
  return v && typeof v === 'object' && 'id' in v && typeof v.id === 'string' ? v.id : null
}

function itemIds(entity: Entity, property: string): string[] {
  return (entity.claims?.[property] ?? []).map(itemId).filter((id): id is string => id !== null)
}

/** A Wikidata time ("+1984-05-19T00:00:00Z") → "1984-05-19"; a year-only time → "1984". */
function timeValue(snak: { datavalue?: { value: unknown } } | undefined): string | null {
  const v = snak?.datavalue?.value
  if (!v || typeof v !== 'object' || !('time' in v) || typeof v.time !== 'string') return null
  const precision = 'precision' in v && typeof v.precision === 'number' ? v.precision : 11
  const m = /^[+-](\d{4})-(\d{2})-(\d{2})/.exec(v.time)
  if (!m) return null
  return precision >= 11 ? `${m[1]}-${m[2]}-${m[3]}` : m[1]!
}

function year(s: string | null): number | null {
  return s ? Number(s.slice(0, 4)) : null
}

/**
 * Read the facts we compare on out of an item. `labelOf` resolves a referenced item's id to its
 * English label (teams, positions) — the caller fetched those in a batch.
 */
export function candidateFacts(entity: Entity, labelOf: (qid: string) => string): CandidateFacts {
  const description = entity.descriptions?.en?.value ?? ''
  return {
    qid: entity.id,
    label: entity.labels?.en?.value ?? entity.id,
    description,
    human: itemIds(entity, P.instanceOf).includes(HUMAN),
    basketball: itemIds(entity, P.sport).includes(BASKETBALL) || /basketball/i.test(description),
    birthDate: timeValue(entity.claims?.[P.birthDate]?.[0]?.mainsnak),
    teams: (entity.claims?.[P.memberOf] ?? []).flatMap((claim) => {
      const id = itemId(claim)
      if (!id) return []
      return [
        {
          label: labelOf(id),
          start: year(timeValue(claim.qualifiers?.[P.start]?.[0])),
          end: year(timeValue(claim.qualifiers?.[P.end]?.[0])),
        },
      ]
    }),
    positions: itemIds(entity, P.position).map(labelOf),
    wnbaIds: (entity.claims?.[P.wnbaId] ?? [])
      .map((c) => c.mainsnak.datavalue?.value)
      .filter((v): v is string => typeof v === 'string'),
  }
}

/** The player's page on WNBA.com, from the ids Wikidata holds ("100433", "chasity-melvin"), or null. */
export function wnbaUrl(ids: string[]): string | null {
  const number = ids.find((id) => /^\d+$/.test(id))
  const slug = ids.find((id) => !/^\d+$/.test(id))
  if (number && slug) return `https://www.wnba.com/player/${number}/${slug}`
  if (number || slug) return `https://www.wnba.com/player/${number ?? slug}/`
  return null
}

/** Every item id an entity refers to that we would want a label for. */
export function referencedIds(entity: Entity): string[] {
  return [...itemIds(entity, P.memberOf), ...itemIds(entity, P.position)]
}

/**
 * Compare one item's facts with what our data says about the player. Teams match on any era name of
 * the franchise. Where Wikidata gives years for a franchise, they agree if any of its windows holds
 * any season we have the player there; a stint Wikidata knows and ESPN has no stats for is not a
 * contradiction, only windows that miss every season of ours are.
 */
export function assess(player: OurPlayer, facts: CandidateFacts): Candidate {
  const teamMatches: string[] = []
  const byFranchise = new Map<OurTeam, { windowed: boolean; covered: boolean }>()
  for (const team of facts.teams) {
    const ours = player.teams.find((t) => t.names.some((n) => normalizeName(n) === normalizeName(team.label)))
    if (!ours) continue
    teamMatches.push(team.label)
    const state = byFranchise.get(ours) ?? { windowed: false, covered: false }
    if (team.start !== null || team.end !== null) {
      state.windowed = true
      if (ours.years.some((y) => (team.start === null || y >= team.start) && (team.end === null || y <= team.end))) {
        state.covered = true
      }
    }
    byFranchise.set(ours, state)
  }
  const windowed = [...byFranchise.values()].filter((f) => f.windowed)
  const yearsAgree = windowed.length === 0 ? null : windowed.every((f) => f.covered)
  let birth: Candidate['birth'] = 'unknown'
  if (player.birthDate && facts.birthDate) {
    // A year-only date on Wikidata still checks the year.
    birth = player.birthDate.startsWith(facts.birthDate) ? 'match' : 'mismatch'
  }
  return { ...facts, teamMatches, yearsAgree, birth, letters: positionLetters(facts.positions) }
}

/**
 * The verdict for one player. Strong: exactly one basketball item shares a team with our data,
 * nothing contradicts it (birth date, team years) and it names one position. None: no basketball
 * item at all, or no item with a position — Wikidata can't place the player, and the reviewer looks
 * elsewhere. Everything in between is review, with each reason spelled out.
 */
export function judge(player: OurPlayer, candidates: Candidate[]): PlayerReport {
  const base = {
    espn: player.espn,
    name: player.name,
    born: player.birthDate,
    seasons: player.seasons,
    career: player.career,
    candidates,
  }
  const none = (why: string): PlayerReport => ({ ...base, verdict: 'none', position: null, source: null, why })
  const players = candidates.filter((c) => c.basketball && (c.human || !c.description))
  if (players.length === 0) return none('No basketball player found under this name.')
  const placed = players.filter((c) => c.letters.length > 0)
  if (placed.length === 0) {
    return none(`${players.map((c) => c.qid).join(', ')} ${players.length === 1 ? 'has' : 'have'} no position.`)
  }
  const clean = placed.filter((c) => c.teamMatches.length > 0 && c.birth !== 'mismatch' && c.yearsAgree !== false)
  if (clean.length === 1 && placed.length === 1 && clean[0]!.letters.length === 1) {
    const c = clean[0]!
    return {
      ...base,
      verdict: 'strong',
      position: c.letters[0]!,
      source: `wikidata:${c.qid}`,
      why: `${c.qid} lists ${c.teamMatches.join(', ')} and ${c.positions.join(', ')}${c.birth === 'match' ? '; birth date matches' : ''}.`,
    }
  }
  const reasons: string[] = []
  if (clean.length > 1) reasons.push(`${clean.length} items match a team: ${clean.map((c) => c.qid).join(', ')}`)
  for (const c of placed) {
    if (c.teamMatches.length === 0)
      reasons.push(`${c.qid} lists no team of ours (${c.teams.map((t) => t.label).join(', ') || 'no teams'})`)
    if (c.birth === 'mismatch') reasons.push(`${c.qid} born ${c.birthDate}, ESPN says ${player.birthDate}`)
    if (c.yearsAgree === false) reasons.push(`${c.qid}'s years with the team miss every season of ours`)
    if (c.letters.length > 1) reasons.push(`${c.qid} names ${c.positions.join(' and ')} (${c.letters.join('/')})`)
  }
  return { ...base, verdict: 'review', position: null, source: null, why: `${reasons.join('; ')}.` }
}

const POSITION_WORDS = /\b(?:point |shooting |combo )?guards?\b|\b(?:small |power )?forwards?\b|\bcent(?:er|re)s?\b/gi

/**
 * The first sentence of an article's lead that names a basketball position, with the letters it
 * names — "…who played center for the Los Angeles Sparks" → C. Only the sentence is quoted, so a
 * reviewer reads the claim itself, not a summary of it.
 */
export function positionSentence(text: string): { sentence: string; letters: Letter[] } | null {
  for (const raw of text.split(/(?<=[.!?])\s+/)) {
    const sentence = raw.trim()
    const words = sentence.match(POSITION_WORDS)
    if (words) return { sentence, letters: positionLetters(words) }
  }
  return null
}

/**
 * The infobox's playing position as plain text, with the field it came from, or null. The basketball
 * biography infobox holds the playing position in `career_position` for someone whose `position` is
 * now a coaching job, and in `position` otherwise. Links are reduced to their shown text
 * ("[[Center (basketball)|Center]]" → "Center"), references dropped. The field is what Wikidata's
 * position claim mirrors, so it is read before the prose.
 */
export function infoboxPosition(wikitext: string): { field: string; text: string } | null {
  // Links and references go first, so a link's own "|" can't pass for the next field's separator.
  const plain = wikitext
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>.*?<\/ref>/gis, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
  for (const field of ['career_position', 'position']) {
    const m = new RegExp(`\\|\\s*${field}\\s*=([^|\\n}]*)`, 'i').exec(plain)
    if (!m) continue
    const text = m[1]!
      .replace(/\{\{[^}]*\}\}/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) return { field, text }
  }
  return null
}

/** What an article says about the position: the infobox first, the lead's sentence second. */
export function articleEvidence(title: string, intro: string, wikitext: string): ArticleEvidence {
  const box = infoboxPosition(wikitext)
  const found = positionSentence(intro)
  const fromInfobox = box ? positionLetters(box.text.split(/[/,;]| and | or /)) : []
  return {
    title,
    infobox: box ? `${box.field} = ${box.text}` : null,
    sentence: found?.sentence ?? null,
    letters: fromInfobox.length > 0 ? fromInfobox : (found?.letters ?? []),
  }
}

/**
 * Fold the article into the report. The verdict stays as the rules found it — a person confirms an
 * article — but a position is proposed when the sentence names exactly one letter and Wikidata's
 * item doesn't name a different one (an item saying F and C and an article saying C agree on C).
 */
export function withArticle(report: PlayerReport, article: ArticleEvidence): PlayerReport {
  const out = { ...report, wikipedia: article }
  if (report.verdict === 'strong' || article.letters.length !== 1) return out
  const letter = article.letters[0]!
  const itemLetters = report.candidates.filter((c) => c.teamMatches.length > 0).flatMap((c) => c.letters)
  if (itemLetters.length > 0 && !itemLetters.includes(letter)) return out
  return { ...out, position: letter, source: `wikipedia:${article.title}` }
}
