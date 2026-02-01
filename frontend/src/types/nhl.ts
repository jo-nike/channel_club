/** NHL team information with score and logos. */
export interface NHLTeam {
  name: string
  abbreviation: string
  score: number
  logo: string
  logoDark: string
}

/** NHL game situation (power play, penalty, etc.). */
export interface NHLSituation {
  awayStrength: number | string
  homeStrength: number | string
  timeRemaining?: string
  awayDescription?: string[]
  homeDescription?: string[]
}

/** Game status type. */
export type GameStatus = 'scheduled' | 'live' | 'final'

/** NHL game information with teams, status, and live details. */
export interface NHLGame {
  id: number
  status: GameStatus
  homeTeam: NHLTeam
  awayTeam: NHLTeam
  startTime: string
  gameCenterLink: string
  /** Live game details (optional, only present when status === 'live'). */
  period?: string
  timeRemaining?: string
  isIntermission?: boolean
  /** Final game outcome (optional, only present when status === 'final' and game went to OT/SO). */
  outcomeType?: string
  /** Situation (optional, power play info). */
  situation?: NHLSituation
}

/** Response model for NHL scores endpoint. */
export interface NHLScoresResponse {
  games: NHLGame[]
  date: string
  liveGameCount: number
}
