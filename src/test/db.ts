/**
 * Helpers for the database tests (*.db.test.ts, `npm run test:db`): a connection to the throwaway test
 * database, a reset between test files, and short builders for made-up players and seasons in the shapes
 * ingest takes from ESPN's parser.
 */
import { Pool } from 'pg'
import { parse } from 'pg-connection-string'
import type { BoxScore, PlayerBio, SeasonRecord } from '../espn/parse'

/** TEST_DATABASE_URL, refused unless it is a local database: the tests empty every table. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is not set: run the database tests with `npm run test:db`')
  const { host } = parse(url)
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`TEST_DATABASE_URL must be a local database (the tests empty every table), not ${host}`)
  }
  return url
}

export const openTestPool = (): Pool => new Pool({ connectionString: testDatabaseUrl() })

/** Empty every table the migrations made (not the migrations checklist), ids restarting at 1. */
export async function resetDatabase(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  )
  await pool.query(`TRUNCATE ${rows.map((r) => r.tablename).join(', ')} RESTART IDENTITY CASCADE`)
}

/** ESPN team ids. Team 6 is the one computeLeague reads the season total from. */
export const T1 = 6
export const T2 = 17

/** A season's totals, as short as the test needs: shots are [made, attempted], unset stats are 0. */
export interface Line {
  gp: number
  pts: number
  fg?: [number, number]
  fg3?: [number, number]
  ft?: [number, number]
  reb?: number
  ast?: number
  stl?: number
  blk?: number
}

function box(l: Line): BoxScore {
  const [fgMade, fgAtt] = l.fg ?? [0, 0]
  const [fg3Made, fg3Att] = l.fg3 ?? [0, 0]
  const [ftMade, ftAtt] = l.ft ?? [0, 0]
  return {
    points: l.pts,
    fgMade,
    fgAtt,
    fg3Made,
    fg3Att,
    ftMade,
    ftAtt,
    oreb: 0,
    dreb: l.reb ?? 0,
    assists: l.ast ?? 0,
    steals: l.stl ?? 0,
    blocks: l.blk ?? 0,
    turnovers: 0,
    fouls: 0,
  }
}

const NO_MISC = {
  doubleDoubles: 0,
  tripleDoubles: 0,
  technicalFouls: 0,
  flagrantFouls: 0,
  disqualifications: 0,
  ejections: 0,
}

/** A regular season with one team. */
export function season(year: number, team: number, line: Line, seasonType = 2): SeasonRecord {
  return {
    year,
    seasonType,
    teamId: team,
    isTotalRow: false,
    gamesPlayed: line.gp,
    box: box(line),
    misc: NO_MISC,
    stints: [],
  }
}

/** A traded player's regular season: the total row, and one stint per team in ESPN's order (last = latest). */
export function tradedSeason(year: number, total: Line, stints: [team: number, gp: number][]): SeasonRecord {
  return {
    year,
    seasonType: 2,
    teamId: null,
    isTotalRow: true,
    gamesPlayed: total.gp,
    box: box(total),
    misc: NO_MISC,
    stints: stints.map(([teamId, gamesPlayed]) => ({ teamId, gamesPlayed, box: box({ gp: gamesPlayed, pts: 0 }) })),
  }
}

export function bio(
  espnId: string,
  name: string,
  position: string | null,
  extra: Partial<Pick<PlayerBio, 'active' | 'currentTeamEspnId' | 'birthDate'>> = {},
): PlayerBio {
  return {
    espnId,
    name,
    position,
    jersey: null,
    active: true,
    currentTeamEspnId: null,
    height: null,
    weight: null,
    birthDate: null,
    draftYear: null,
    draftRound: null,
    draftPick: null,
    headshotUrl: null,
    ...extra,
  }
}

/** Each team's games in a season (team_season_games), by ESPN team id. */
export async function setTeamGames(pool: Pool, rows: [team: number, year: number, games: number][]): Promise<void> {
  for (const [team, year, games] of rows) {
    const { rowCount } = await pool.query(
      `INSERT INTO team_season_games (team_id, season_year, games, source)
       SELECT id, $2, $3, 'team_stats' FROM teams WHERE espn_id = $1`,
      [String(team), year, games],
    )
    if (rowCount !== 1) throw new Error(`setTeamGames: no team ${team} (ingest a player on it first)`)
  }
}
