-- 008 — team_season_games: how many regular-season games each team played in a season (or has
-- played so far, for the season in progress) — the "Y" in a player's "17 of Y games", and the
-- slate every games bar scales by (small sample, partial, qualified, the shooting-% rank floors).
-- Until now one team's count (the Sparks') stood in for every team: exact in a finished season
-- except the 2018 Aces and Mystics (33 of 34 — the Aug 3 forfeit), and off by the teams' spread
-- mid-season. Filled by src/db/teamGames.ts:
--   * a finished season: ESPN team statistics gamesPlayed (+ TEAM_GAMES_CORRECTIONS), else the
--     season total (league_seasons.scheduled_games) — ESPN has no team statistics for the Comets
--     2007–08 or the Monarchs 2007–09;
--   * the season in progress: the team's schedule — completed games, not the Commissioner's Cup
--     final, not forfeits, a duplicate listing once (daily).
-- Measured on all 380 team-seasons 1997–2026 on 2026-09-26.

CREATE TABLE IF NOT EXISTS team_season_games (
    team_id bigint NOT NULL REFERENCES teams(id),
    season_year smallint NOT NULL,
    games smallint NOT NULL CHECK (games > 0),
    -- Where `games` came from, so any number can be traced: ESPN team statistics, a hand-checked
    -- correction, the season total (ESPN had nothing for the team), or the team's schedule.
    source text NOT NULL CHECK (source IN ('team_stats', 'correction', 'season_total', 'schedule')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, season_year)
);

-- Same auto-bump trigger the other tables use (set_updated_at, from migration 002).
DROP TRIGGER IF EXISTS team_season_games_set_updated_at ON team_season_games;
CREATE TRIGGER team_season_games_set_updated_at BEFORE UPDATE ON team_season_games
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The one definition of a player-season's Y, read by computeLeague, computePositions, the API's
-- rank query and GET /players/:id — so a note, a cell's tier, a rank and the averages always use
-- the same number. The player's team is the season's team, or for a traded player the last team
-- they played for: the last stint ESPN lists (stored in ESPN's order; checked 2026-09-26 — for
-- all 19 players traded in 2026 whose current team is known, the last stint is that team).
-- Never smaller than the player's own games: mid-season, a player traded from a team further
-- along could otherwise read "15 of 13". NULL when the team has no row yet — each reader falls
-- back to the season total it already has (league_seasons.scheduled_games).
-- Regular season only (team_season_games counts regular-season games).
CREATE OR REPLACE VIEW player_season_team_games AS
SELECT ps.id AS season_id,
       CASE WHEN tg.games IS NULL THEN NULL ELSE GREATEST(ps.games_played, tg.games) END AS team_games
FROM player_seasons ps
CROSS JOIN LATERAL (
  SELECT COALESCE(
           ps.team_id,
           (SELECT st.team_id FROM player_season_stints st WHERE st.season_id = ps.id ORDER BY st.id DESC LIMIT 1)
         ) AS team_id
) AS last_team
LEFT JOIN team_season_games tg ON tg.team_id = last_team.team_id AND tg.season_year = ps.season_year
WHERE ps.season_type = 2;
