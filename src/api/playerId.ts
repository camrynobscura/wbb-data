/** The largest value a Postgres bigint (players.id) can hold. */
const MAX_BIGINT = 9223372036854775807n

/**
 * Could this be a player id? Digits only, and within bigint's range — anything else would make
 * Postgres throw (a cast error, or "out of range for type bigint" → a 500 and a logged error)
 * instead of simply finding no such player. Checked before the query so it's a clean 404.
 */
export function isPlayerId(id: string): boolean {
  return /^\d{1,19}$/.test(id) && BigInt(id) <= MAX_BIGINT
}
