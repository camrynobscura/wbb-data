import type { Pool } from 'pg'
import type { SeasonRecord, StintRecord } from '../espn/parse'
import { upsertReturningId } from './upsert'

/**
 * Insert or update one canonical season (player_seasons), returning its id.
 * Generated columns (rebounds, ts_pct, …) are omitted — the DB computes them.
 * minutes and the role rates are left null (filled by the 2nd pass).
 */
export async function upsertSeason(
  pool: Pool,
  playerId: string,
  teamId: string | null,
  isCurrentSeason: boolean,
  season: SeasonRecord,
): Promise<string> {
  const b = season.box
  const m = season.misc
  return upsertReturningId(
    pool,
    'player_seasons',
    ['player_id', 'season_year', 'season_type'],
    {
      player_id: playerId,
      season_year: season.year,
      season_type: season.seasonType,
      team_id: teamId,
      games_played: season.gamesPlayed,
      is_total_row: season.isTotalRow,
      is_current_season: isCurrentSeason,
      points: b.points,
      fg_made: b.fgMade,
      fg_att: b.fgAtt,
      fg3_made: b.fg3Made,
      fg3_att: b.fg3Att,
      ft_made: b.ftMade,
      ft_att: b.ftAtt,
      oreb: b.oreb,
      dreb: b.dreb,
      assists: b.assists,
      steals: b.steals,
      blocks: b.blocks,
      turnovers: b.turnovers,
      fouls: b.fouls,
      double_doubles: m.doubleDoubles,
      triple_doubles: m.tripleDoubles,
      technical_fouls: m.technicalFouls,
      flagrant_fouls: m.flagrantFouls,
      disqualifications: m.disqualifications,
      ejections: m.ejections,
    },
  )
}

/** Insert or update one per-team stint (player_season_stints) for a traded year. */
export async function upsertStint(
  pool: Pool,
  seasonId: string,
  teamId: string,
  stint: StintRecord,
): Promise<string> {
  const b = stint.box
  return upsertReturningId(
    pool,
    'player_season_stints',
    ['season_id', 'team_id'],
    {
      season_id: seasonId,
      team_id: teamId,
      games_played: stint.gamesPlayed,
      points: b.points,
      fg_made: b.fgMade,
      fg_att: b.fgAtt,
      fg3_made: b.fg3Made,
      fg3_att: b.fg3Att,
      ft_made: b.ftMade,
      ft_att: b.ftAtt,
      oreb: b.oreb,
      dreb: b.dreb,
      assists: b.assists,
      steals: b.steals,
      blocks: b.blocks,
      turnovers: b.turnovers,
      fouls: b.fouls,
    },
  )
}
