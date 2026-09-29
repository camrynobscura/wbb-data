/**
 * Run `worker` over every item in `items`, with at most `limit` calls in flight
 * at once. A small fixed pool of runners pulls from a shared cursor, so a slow
 * item never blocks the others and we never open more than `limit` connections
 * to ESPN at a time. Order of completion is not preserved.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      if (item !== undefined) await worker(item)
    }
  })
  await Promise.all(runners)
}
