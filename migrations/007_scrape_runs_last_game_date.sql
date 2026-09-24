-- "Stats through <date>": the date of the latest COMPLETED regular-season game ESPN's schedules
-- showed when a refresh ran. The footer used to show the run's finish time ("Data current as of"),
-- which in the off-season reads as if something changed yesterday. Recorded per run so GET /meta
-- can serve the most recent non-null value (a run whose schedule fetch failed leaves it null).
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS last_game_date date;
