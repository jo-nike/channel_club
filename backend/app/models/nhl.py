"""NHL scores models for Channel Club API."""

from pydantic import Field

from app.models.base import CamelModel


class NHLTeam(CamelModel):
    """NHL team information with score and logos."""

    name: str
    abbreviation: str
    score: int = 0
    logo: str
    logo_dark: str


class NHLBroadcast(CamelModel):
    """NHL game broadcast (TV network carrying the game)."""

    network: str  # e.g. "ESPN", "SN", "TVAS", "FDSNSO"
    market: str  # "N" (national) | "H" (home regional) | "A" (away regional)
    country_code: str  # "US" | "CA"


class NHLSituation(CamelModel):
    """NHL game situation (power play, penalty, etc.)."""

    away_strength: int | str
    home_strength: int | str
    time_remaining: str | None = None
    away_description: list[str] | None = None
    home_description: list[str] | None = None


class NHLGame(CamelModel):
    """NHL game information with teams, status, and live details."""

    id: int
    status: str  # 'scheduled' | 'live' | 'final'
    home_team: NHLTeam
    away_team: NHLTeam
    start_time: str
    game_center_link: str
    # Live game details (optional, only present when status == 'live')
    period: str | None = None
    time_remaining: str | None = None
    is_intermission: bool | None = None
    # Final game outcome (optional, only present when status == 'final' and game went to OT/SO)
    outcome_type: str | None = None
    # Situation (optional, power play info)
    situation: NHLSituation | None = None
    # TV broadcasts carrying the game (national + regional)
    broadcasts: list[NHLBroadcast] = Field(default_factory=list)


class NHLScoresResponse(CamelModel):
    """Response model for NHL scores endpoint."""

    games: list[NHLGame]
    date: str
    live_game_count: int
