/**
 * The season constants every pipeline stage shares — one home, so "which years exist" and
 * "who counts as current" can't drift between discovery, the league math and the API.
 */

/** The WNBA's first season. A full-history build discovers players from here. */
export const FIRST_WNBA_SEASON = 1997

/**
 * The rolling "current players" window: everyone who appeared in at least one game
 * (regular season or playoffs) in the last N seasons. Deliberately a window, not a live
 * roster: a player out injured or overseas stays current, and her absent year renders as a
 * gap. The daily refresh discovers this set, and it's the API's default /players scope.
 */
export const ROSTER_WINDOW_YEARS = 3

/**
 * The season in progress (or the one just finished). The WNBA plays one season per calendar
 * year, so the year is a fine proxy: it's what lets everything roll into the next season with no code
 * change.
 */
export const currentSeason = (): number => new Date().getFullYear()

/** First year of the rolling window that ends at `current`: 2026 → 2024. */
export const windowStart = (current: number): number => current - ROSTER_WINDOW_YEARS + 1
