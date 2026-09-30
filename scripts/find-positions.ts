/**
 * Find a position on Wikidata for every qualified player ESPN leaves unplaced in the given seasons,
 * and write a candidate file for review. ESPN has no position for most players before 2012, and the
 * coverage gate (migration 005) keeps a season out of position mode until every qualified player that
 * year is placed — so the point of a season is placing ALL of its unplaced players. Basketball-Reference
 * has them all but its terms bar building a public site on scraped data; Wikidata is CC0, and its items
 * carry the player's teams, which is what this matches on (no ESPN id exists there).
 *
 * Nothing is written to the database. The rules are in src/wikidata/positions.ts; the verdicts:
 *   strong  one basketball item lists a WNBA team the player was on in our data, nothing contradicts
 *           it, and it names one position — the row is filled in;
 *   review  the evidence is incomplete or two items compete — the reason says what to look at;
 *   none    Wikidata can't place the player — look elsewhere.
 * A person approves the file; the approved rows become the checked-in override list.
 *
 *   npx tsx scripts/find-positions.ts                 the seasons position mode could gain: 2009 2010 2011
 *   npx tsx scripts/find-positions.ts 2011            one season (its 8 players, a minute)
 *   npx tsx scripts/find-positions.ts 2005 2006 2007 2008
 *
 * Writes data/position-candidates.json (git-ignored). Every Wikidata response is kept in
 * data/wikidata-cache.json, so a re-run is instant and free; delete it to fetch afresh.
 */

// Load .env for local dev; in CI (GitHub Actions) there's no file — env vars are
// injected from repo secrets — so a missing .env is normal; don't crash on it.
try {
  process.loadEnvFile()
} catch {
  /* no .env present — rely on real environment variables */
}

import { mkdirSync, writeFileSync } from 'node:fs'
import { Pool } from 'pg'
import { dbConfig } from '../src/db/connect'
import { FULL_SCHEDULE_GAMES, QUALIFYING_GAMES } from '../src/db/computeLeague'
import { WikimediaClient, type Entity } from '../src/wikidata/client'
import {
  assess,
  candidateFacts,
  judge,
  nameVariants,
  articleEvidence,
  referencedIds,
  withArticle,
  type OurPlayer,
  type OurTeam,
  type PlayerReport,
} from '../src/wikidata/positions'
import { reviewSheet } from '../src/wikidata/sheet'

const OUT = 'data/position-candidates.json'
const SHEET = 'data/position-review.md'
const CACHE = 'data/wikidata-cache.json'
const DEFAULT_YEARS = [2009, 2010, 2011]

// The qualified player-seasons with no position, the same bar computeLeague draws ($2/$3 and the
// player's own team's games), for the given years ($1).
const UNPLACED_SQL = `
SELECT p.espn_id AS espn, p.name, p.birth_date::text AS birth_date,
       array_agg(ps.season_year || ' ' || COALESCE(e.abbreviation, '?') ORDER BY ps.season_year) AS seasons
FROM player_seasons ps
JOIN players p         ON p.id = ps.player_id
JOIN league_seasons ls ON ls.season_year = ps.season_year
LEFT JOIN player_season_team_games v ON v.season_id = ps.id
LEFT JOIN LATERAL (
  SELECT COALESCE(ps.team_id,
    (SELECT st.team_id FROM player_season_stints st WHERE st.season_id = ps.id ORDER BY st.id DESC LIMIT 1)) AS team_id
) t ON true
LEFT JOIN team_eras e ON e.team_id = t.team_id AND e.start_year <= ps.season_year
                     AND (e.end_year IS NULL OR e.end_year >= ps.season_year)
WHERE ps.season_type = 2
  AND p.position IS NULL
  AND ps.season_year = ANY($1::int[])
  AND ps.games_played * $3::int >= $2::int * COALESCE(v.team_games, ls.scheduled_games)
GROUP BY p.id
ORDER BY p.name`

// Every season a player was on a team (the season's team, or each stint's for a traded player), with
// the era name of that season and every era name of the franchise — the names Wikidata might use.
const TEAMS_SQL = `
WITH on_team AS (
  SELECT ps.player_id, ps.season_year, ps.team_id FROM player_seasons ps WHERE ps.team_id IS NOT NULL
  UNION
  SELECT ps.player_id, ps.season_year, st.team_id
  FROM player_season_stints st JOIN player_seasons ps ON ps.id = st.season_id
)
SELECT p.espn_id AS espn, o.team_id, o.season_year AS year, e.name AS era,
       (SELECT array_agg(DISTINCT e2.name) FROM team_eras e2 WHERE e2.team_id = o.team_id) AS names
FROM on_team o JOIN players p ON p.id = o.player_id
LEFT JOIN team_eras e ON e.team_id = o.team_id AND e.start_year <= o.season_year
                     AND (e.end_year IS NULL OR e.end_year >= o.season_year)
WHERE p.espn_id = ANY($1::text[])
ORDER BY p.espn_id, o.season_year`

async function main(): Promise<void> {
  const years = process.argv.slice(2).map(Number)
  if (years.some((y) => !Number.isInteger(y))) throw new Error('years must be integers, e.g. 2009 2010 2011')
  const wanted = years.length > 0 ? years : DEFAULT_YEARS

  const pool = new Pool(dbConfig())
  const unplaced = await pool.query<{ espn: string; name: string; birth_date: string | null; seasons: string[] }>(
    UNPLACED_SQL,
    [wanted, QUALIFYING_GAMES, FULL_SCHEDULE_GAMES],
  )
  const onTeam = await pool.query<{ espn: string; team_id: string; year: number; era: string | null; names: string[] }>(
    TEAMS_SQL,
    [unplaced.rows.map((r) => r.espn)],
  )
  await pool.end()

  const players: OurPlayer[] = unplaced.rows.map((r) => {
    const rows = onTeam.rows.filter((t) => t.espn === r.espn)
    const teams = new Map<string, OurTeam>()
    for (const t of rows) {
      const team = teams.get(t.team_id) ?? { names: t.names, years: [] }
      team.years.push(t.year)
      teams.set(t.team_id, team)
    }
    return {
      espn: r.espn,
      name: r.name,
      birthDate: r.birth_date,
      seasons: r.seasons,
      career: rows.map((t) => `${t.era ?? '?'} ${t.year}`),
      teams: [...teams.values()],
    }
  })
  console.log(`${players.length} unplaced qualified players in ${wanted.join(', ')}`)

  // Pass 1: find each player's basketball items and fetch them. Pass 2: one batch for the labels of
  // every team and position they refer to. Then judge — the labels are needed to compare.
  const wd = new WikimediaClient(CACHE)
  const found = new Map<string, Entity[]>()
  for (const player of players) {
    let items: Entity[] = []
    // Every hit is fetched, whatever its description says: Marion Jones's item is the sprinter's, and
    // only its sport claim says basketball too. The rules decide what counts.
    for (const variant of nameVariants(player.name)) {
      const hits = await wd.search(variant)
      if (hits.length === 0) continue
      items = Object.values(await wd.entities(hits.map((h) => h.id)))
      if (items.some((e) => candidateFacts(e, () => '').basketball)) break
    }
    found.set(player.espn, items)
    process.stdout.write(`  ${player.name}: ${items.length} item${items.length === 1 ? '' : 's'}\n`)
  }
  const labelIds = [...found.values()].flat().flatMap(referencedIds)
  const labelled = await wd.entities(labelIds, 'labels')
  const labelOf = (qid: string) => labelled[qid]?.labels?.en?.value ?? qid

  let reports: PlayerReport[] = players.map((player) =>
    judge(
      player,
      (found.get(player.espn) ?? []).map((e) => assess(player, candidateFacts(e, labelOf))),
    ),
  )

  // Pass 3, for the players the rules couldn't place: the Wikipedia article behind the item that
  // matched a team (or the first basketball item) — its infobox's position field and the lead's
  // sentence naming one, quoted on the sheet for the reviewer.
  const needArticle = reports.filter((r) => r.verdict !== 'strong')
  const itemFor = (r: PlayerReport) =>
    (r.candidates.find((c) => c.basketball && c.teamMatches.length > 0) ?? r.candidates.find((c) => c.basketball))?.qid
  const titles = await wd.articleTitles(needArticle.map(itemFor).filter((q): q is string => q !== undefined))
  reports = await Promise.all(
    reports.map(async (r) => {
      const qid = r.verdict === 'strong' ? undefined : itemFor(r)
      const title = qid && titles[qid]
      if (!title) return r
      const page = await wd.article(title)
      return page ? withArticle(r, articleEvidence(title, page.intro, page.wikitext)) : r
    }),
  )

  mkdirSync('data', { recursive: true })
  const generatedAt = new Date().toISOString()
  writeFileSync(OUT, JSON.stringify({ years: wanted, generatedAt, players: reports }, null, 2))
  writeFileSync(SHEET, reviewSheet(wanted, generatedAt, reports))

  console.table(
    reports.map((r) => ({
      name: r.name,
      seasons: r.seasons.join(', '),
      verdict: r.verdict,
      pos: r.position ?? '',
      source: r.source ?? '',
      why: r.why.length > 90 ? `${r.why.slice(0, 87)}...` : r.why,
    })),
  )
  const count = (v: PlayerReport['verdict']) => reports.filter((r) => r.verdict === v).length
  const open = reports.filter((r) => r.position === null).length
  console.log(`strong ${count('strong')} · review ${count('review')} · none ${count('none')} · still open ${open}`)
  for (const y of wanted) {
    const inYear = reports.filter((r) => r.seasons.some((s) => s.startsWith(`${y} `)))
    const openInYear = inYear.filter((r) => r.position === null).length
    console.log(`  ${y}: ${inYear.length - openInYear} of ${inYear.length} have a letter; ${openInYear} open`)
  }
  console.log(`written ${OUT} and ${SHEET} · ${wd.liveRequests} live requests`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
