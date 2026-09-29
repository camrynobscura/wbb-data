import type { Pool } from 'pg'

/** Open a scrape_runs row (status 'running'), returning its id. */
export async function startScrapeRun(pool: Pool): Promise<string> {
  const res = await pool.query(`INSERT INTO scrape_runs (status) VALUES ('running') RETURNING id`)
  return (res.rows[0] as { id: string }).id
}

/** Close out a scrape_runs row with its final status, count, any error, and — from the daily
    refresh — the latest completed game date the schedules showed ("Stats through …", migration 007;
    null when unknown, and GET /meta then falls back to the last run that knew). */
export async function finishScrapeRun(
  pool: Pool,
  runId: string,
  status: 'success' | 'error',
  playersUpdated: number,
  error?: string,
  lastGameDate?: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE scrape_runs
       SET finished_at = now(), status = $2, players_updated = $3, error = $4, last_game_date = $5
     WHERE id = $1`,
    [runId, status, playersUpdated, error ?? null, lastGameDate ?? null],
  )
}
