/**
 * Pass A — discovery, standalone: print the size of the player universe without
 * writing anything. The real logic lives in src/espn/client.ts (shared with scrape.ts
 * and the daily refresh); this is its dry run. A player found in several (year, type)
 * lists is counted once — the client dedupes with a Set.
 *
 * The rolling window (D1):  npx tsx scripts/discover-players.ts
 * The whole league, 1997→:  npx tsx scripts/discover-players.ts --all
 */

import { discoverPlayerIds } from '../src/espn/client'
import { currentSeason, FIRST_WNBA_SEASON, ROSTER_WINDOW_YEARS, windowStart } from '../src/seasons'

async function main(): Promise<void> {
  const all = process.argv.includes('--all')
  const year = currentSeason()
  const ids = await discoverPlayerIds(all ? FIRST_WNBA_SEASON : windowStart(year), year)
  const span = all
    ? `${FIRST_WNBA_SEASON}–${year}`
    : `${windowStart(year)}–${year} (the ${ROSTER_WINDOW_YEARS}-season window)`
  console.log(`✅ ${ids.length} unique players across ${span}.`)
}

main().catch((err) => {
  console.error('❌ discover-players failed:', err)
  process.exitCode = 1
})
