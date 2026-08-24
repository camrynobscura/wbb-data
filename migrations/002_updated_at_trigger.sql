-- 002 — auto-bump updated_at on every UPDATE, so the timestamp can never go stale
-- even if a future write path (or a manual SQL edit) forgets to set it. Previously
-- this relied on the app code setting `updated_at = now()` by hand on every write.

-- The function every trigger calls: stamp the row being written with the current time.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- One BEFORE UPDATE trigger per table that has an updated_at column (all but
-- scrape_runs). DROP IF EXISTS first so the migration is safe to re-run.
DROP TRIGGER IF EXISTS teams_set_updated_at ON teams;
CREATE TRIGGER teams_set_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS players_set_updated_at ON players;
CREATE TRIGGER players_set_updated_at BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS team_eras_set_updated_at ON team_eras;
CREATE TRIGGER team_eras_set_updated_at BEFORE UPDATE ON team_eras
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS player_seasons_set_updated_at ON player_seasons;
CREATE TRIGGER player_seasons_set_updated_at BEFORE UPDATE ON player_seasons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS player_season_stints_set_updated_at ON player_season_stints;
CREATE TRIGGER player_season_stints_set_updated_at BEFORE UPDATE ON player_season_stints
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS league_seasons_set_updated_at ON league_seasons;
CREATE TRIGGER league_seasons_set_updated_at BEFORE UPDATE ON league_seasons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
