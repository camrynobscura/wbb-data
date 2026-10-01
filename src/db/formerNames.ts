/**
 * Names ESPN replaced before the database kept them, keyed by ESPN id, oldest first. Ingest records
 * a name change from the day it sees one, but the database is rebuilt from ESPN, which only has
 * today's name — so a rename worth keeping across a rebuild is written here too. Add an entry when
 * the refresh reports a renamed player.
 */
export const KNOWN_FORMER_NAMES: Readonly<Record<string, readonly string[]>> = {
  '3054590': ['Nia Coffey'], // Nia Brodie; renamed on ESPN during the 2026 season
}

/**
 * The former names to store after an ingest: what was stored, then the known ones, then the name
 * being replaced — each once, in that order, and never the name the player has now (a player who
 * goes back to an earlier name stops being "formerly" it).
 */
export function nextFormerNames(
  stored: readonly string[],
  storedName: string | null,
  newName: string,
  known: readonly string[] = [],
): string[] {
  const out: string[] = []
  const add = (name: string | null) => {
    if (name && name !== newName && !out.includes(name)) out.push(name)
  }
  stored.forEach(add)
  known.forEach(add)
  add(storedName)
  return out
}
