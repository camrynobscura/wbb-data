/**
 * Pass A — discovery. Builds the player universe for the scrape: every WNBA
 * athlete who appeared in at least one game in the last ROSTER_WINDOW_YEARS
 * seasons. Output is a deduplicated set of ESPN athlete ids — nothing is written
 * to the database here. Later passes loop over this list.
 *
 * Run it with:  npx tsx scripts/discover-players.ts
 */

// How many seasons back the "current players" window reaches. One tunable
// constant, so the window rolls forward on its own each year.
const ROSTER_WINDOW_YEARS = 3

// The window ends at the current season and counts backward. The WNBA plays one
// calendar year per season, so the current year is a fine proxy for "current
// season." In 2026 this yields [2026, 2025, 2024].
const CURRENT_SEASON = new Date().getFullYear()

const WINDOW_YEARS: number[] = []
for (let i = 0; i < ROSTER_WINDOW_YEARS; i++) {
  WINDOW_YEARS.push(CURRENT_SEASON - i)
}

// The byathlete endpoint: everyone who appeared in one (season, seasontype).
const BYATHLETE_BASE =
  'https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/statistics/byathlete'

// Fetch one (year, seasonType) list and return just the athlete ids it contains.
async function fetchAthleteIds(
  year: number,
  seasonType: number,
): Promise<string[]> {
  // isqualified=false is essential — it keeps low-minute players who'd otherwise
  // be dropped. limit=1000 gets the whole list in one page.
  const url = `${BYATHLETE_BASE}?season=${year}&seasontype=${seasonType}&limit=1000&isqualified=false`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `byathlete ${year} type ${seasonType} → ${res.status} ${res.statusText}`,
    )
  }

  // res.json() is typed `unknown` (it's untrusted external data). We assert the
  // one slice of the shape we rely on — an `athletes` array of entries that each
  // carry an `athlete.id`. Just enough to be type-safe, not the whole response.
  const data = (await res.json()) as {
    athletes?: { athlete: { id: string } }[]
  }

  // `?? []` guards a missing/empty list; then map each entry to its athlete.id.
  const athletes = data.athletes ?? []
  return athletes.map((entry) => entry.athlete.id)
}

// Season types to include: 2 = regular season, 3 = playoffs. Both, so a player
// who appeared ONLY in the playoffs (injured all regular season, back for the
// postseason) still makes the universe.
const SEASON_TYPES = [2, 3]

async function main(): Promise<void> {
  // A Set stores each value at most once, so a player found in several
  // (year, type) lists is automatically counted a single time.
  const ids = new Set<string>()

  for (const year of WINDOW_YEARS) {
    for (const seasonType of SEASON_TYPES) {
      const found = await fetchAthleteIds(year, seasonType)
      for (const id of found) {
        ids.add(id)
      }
      console.log(`  ${year} type ${seasonType}: ${found.length} players`)
    }
  }

  console.log(`\n✅ Discovered ${ids.size} unique players across the window.`)
}

main().catch((err) => {
  console.error('❌ discover-players failed:', err)
  process.exitCode = 1
})
