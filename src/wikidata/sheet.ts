import { wnbaUrl, type PlayerReport } from './positions'

/**
 * The review sheet: one Markdown line per player, for a person to read and sign off. Everything the
 * sign-off rests on is on the line — the letter, where it came from, the evidence as a quote or the
 * rules' reason, and the player's career in our data (so a team named in the evidence can be placed).
 */

/** "Cleveland Rockers 1999–2003, Washington Mystics 2004–2006, Chicago Sky 2007" from one entry per season. */
export function careerSpans(career: string[]): string {
  const spans: { team: string; from: number; to: number }[] = []
  for (const entry of career) {
    const team = entry.slice(0, -5)
    const year = Number(entry.slice(-4))
    const last = spans.at(-1)
    if (last && last.team === team && year === last.to + 1) last.to = year
    else spans.push({ team, from: year, to: year })
  }
  return spans.map((s) => `${s.team} ${s.from === s.to ? s.from : `${s.from}–${s.to}`}`).join(', ')
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ')

export function reviewSheet(years: number[], generatedAt: string, reports: PlayerReport[]): string {
  const rows = reports.map((r, i) => {
    const article = r.wikipedia
    // Addresses are written out, not linked: the reviewer reads this as a plain file. WNBA.com is the
    // league's own listing, the reference a doubt is settled against; the evidence ends with where the
    // letter was read.
    const item =
      r.candidates.find((c) => `wikidata:${c.qid}` === r.source) ??
      r.candidates.find((c) => c.basketball && c.teamMatches.length > 0) ??
      r.candidates.find((c) => c.basketball)
    const wnba = item ? wnbaUrl(item.wnbaIds) : null
    const sourceUrl = article
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, '_'))}`
      : item
        ? `https://www.wikidata.org/wiki/${item.qid}`
        : null
    const status = r.verdict === 'strong' ? 'found' : r.position ? 'confirm' : 'open'
    const evidence = [r.why]
    if (article) {
      if (article.infobox) evidence.push(`Wikipedia infobox: ${article.infobox}.`)
      if (article.sentence) evidence.push(`Wikipedia: "${article.sentence}"`)
      if (!article.infobox && !article.sentence) evidence.push('Wikipedia: no position in the infobox or the lead.')
    }
    if (sourceUrl) evidence.push(sourceUrl)
    return `| ${i + 1} | ${r.name} | ${wnba ?? ''} | ${r.seasons.join(', ')} | ${r.position ?? ''} | ${status} | ${cell(evidence.join(' '))} | ${cell(careerSpans(r.career))} |`
  })
  const count = (status: string) => rows.filter((row) => row.includes(`| ${status} |`)).length
  return [
    `# Position review — ${years.join(', ')}`,
    '',
    `Generated ${generatedAt} by \`scripts/find-positions.ts\` from \`data/position-candidates.json\`. One line per qualified player ESPN leaves unplaced in these seasons; **WNBA.com** is her page there, the league's own listing (its first position wins when sources disagree); the address at the end of the evidence is where the letter was read. **Pos** is the letter that would be stored. **found**: the rules placed the player — the Wikidata item lists a team the player was on in our data, nothing contradicts it, and it names one position. **confirm**: Wikidata alone couldn't, and the Wikipedia infobox (or the lead's quoted sentence) names the position — read it and agree or change the letter. **open**: nothing found a position — fill the letter in from a source you read, or leave it and the season stays gated. Reply with the rows to change or fill; every other row is approved as shown.`,
    '',
    `${count('found')} found · ${count('confirm')} confirm · ${count('open')} open`,
    '',
    '| # | Player | WNBA.com | Unplaced seasons | Pos | Status | Evidence | In our data |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}
