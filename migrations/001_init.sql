-- 001_init — baseline schema. This is the full current schema, made idempotent
-- (IF NOT EXISTS / CREATE OR REPLACE) so it is a safe no-op on the existing live
-- database and a full build on a fresh one. Migrations are the source of truth for
-- the schema from here on; later files (002+) make incremental changes.

-- teams is a root table (franchise identity only, references nothing), so it is
-- created first — players.current_team_id and player_seasons.team_id both point at it.
CREATE TABLE IF NOT EXISTS teams (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    espn_id text UNIQUE NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    espn_id text UNIQUE NOT NULL,
    name text NOT NULL,
    position text,
    jersey smallint,
    current_team_id bigint REFERENCES teams(id),
    height smallint,
    weight smallint,
    birth_date date,
    draft_year smallint,
    draft_round smallint,
    draft_pick smallint,
    headshot_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_eras (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id bigint NOT NULL REFERENCES teams(id),
    name text NOT NULL,
    abbreviation text NOT NULL,
    start_year smallint NOT NULL,
    end_year smallint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, start_year),
    CHECK (
        end_year IS NULL
        OR end_year >= start_year
    )
);

CREATE TABLE IF NOT EXISTS player_seasons (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id bigint NOT NULL REFERENCES players(id),
    season_year smallint NOT NULL,
    season_type smallint NOT NULL DEFAULT 2 CHECK (season_type IN (2, 3)),
    team_id bigint REFERENCES teams(id),
    games_played smallint NOT NULL,
    is_total_row boolean NOT NULL DEFAULT false,
    is_current_season boolean NOT NULL DEFAULT false,
    points integer NOT NULL,
    fg_made integer NOT NULL,
    fg_att integer NOT NULL,
    fg3_made integer NOT NULL,
    fg3_att integer NOT NULL,
    ft_made integer NOT NULL,
    ft_att integer NOT NULL,
    oreb integer NOT NULL,
    dreb integer NOT NULL,
    assists integer NOT NULL,
    steals integer NOT NULL,
    blocks integer NOT NULL,
    turnovers integer NOT NULL,
    fouls integer NOT NULL,
    minutes numeric,
    rebounds integer GENERATED ALWAYS AS (oreb + dreb) STORED,
    ts_pct numeric GENERATED ALWAYS AS (points / NULLIF(2 * (fg_att + 0.44 * ft_att), 0)) STORED,
    efg_pct numeric GENERATED ALWAYS AS ((fg_made + 0.5 * fg3_made) / NULLIF(fg_att, 0)) STORED,
    tov_pct numeric GENERATED ALWAYS AS (
        turnovers / NULLIF(fg_att + 0.44 * ft_att + turnovers, 0)
    ) STORED,
    fg3a_rate numeric GENERATED ALWAYS AS (fg3_att :: numeric / NULLIF(fg_att, 0)) STORED,
    ft_rate numeric GENERATED ALWAYS AS (ft_att :: numeric / NULLIF(fg_att, 0)) STORED,
    usg_pct numeric,
    ast_pct numeric,
    oreb_pct numeric,
    dreb_pct numeric,
    treb_pct numeric,
    double_doubles integer,
    triple_doubles integer,
    technical_fouls integer,
    flagrant_fouls integer,
    disqualifications integer,
    ejections integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (player_id, season_year, season_type),
    CHECK ( (is_total_row AND team_id IS NULL) OR (NOT is_total_row AND team_id IS NOT NULL) )
);

CREATE TABLE IF NOT EXISTS player_season_stints (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    season_id bigint NOT NULL REFERENCES player_seasons(id),
    team_id bigint NOT NULL REFERENCES teams(id),
    games_played smallint NOT NULL,
    points integer NOT NULL,
    fg_made integer NOT NULL,
    fg_att integer NOT NULL,
    fg3_made integer NOT NULL,
    fg3_att integer NOT NULL,
    ft_made integer NOT NULL,
    ft_att integer NOT NULL,
    oreb integer NOT NULL,
    dreb integer NOT NULL,
    assists integer NOT NULL,
    steals integer NOT NULL,
    blocks integer NOT NULL,
    turnovers integer NOT NULL,
    fouls integer NOT NULL,
    minutes numeric,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (season_id, team_id)
);

CREATE TABLE IF NOT EXISTS league_seasons (
    season_year smallint PRIMARY KEY,
    scheduled_games smallint NOT NULL,
    avg_points numeric,
    avg_rebounds numeric,
    avg_assists numeric,
    avg_steals numeric,
    avg_blocks numeric,
    avg_turnovers numeric,
    avg_fg_pct numeric,
    avg_fg3_pct numeric,
    avg_ts_pct numeric,
    avg_efg_pct numeric,
    avg_tov_pct numeric,
    avg_fg3a_rate numeric,
    avg_ft_rate numeric,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scrape_runs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
    players_updated integer,
    error text
);

-- Index names are Postgres's own defaults for these columns, so IF NOT EXISTS
-- matches the indexes already on the live DB (a true no-op there).
CREATE INDEX IF NOT EXISTS player_seasons_team_id_idx ON player_seasons (team_id);
CREATE INDEX IF NOT EXISTS player_season_stints_team_id_idx ON player_season_stints (team_id);

-- Each player's CURRENT team resolved to its era-correct name. players.current_team_id
-- is the authoritative current/last team (parsed from the bio's team ref, so it's
-- right even for mid-season trades); the current era is the team_eras row with no
-- end_year. The per-season year-range view can be added when per-season teams are
-- surfaced in the UI (v1 shows only the current team).
CREATE OR REPLACE VIEW player_current_team AS
SELECT p.id            AS player_id,
       te.name         AS team_name,
       te.abbreviation AS team_abbr
FROM players p
LEFT JOIN team_eras te
       ON te.team_id = p.current_team_id
      AND te.end_year IS NULL;
