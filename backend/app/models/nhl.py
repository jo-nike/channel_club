"""NHL scores models for IPTV Viewer API."""

from pydantic import BaseModel, Field


class NHLTeam(BaseModel):
    """NHL team information with score and logos."""

    name: str
    abbreviation: str
    score: int = 0
    logo: str
    logo_dark: str = Field(alias="logoDark")

    model_config = {"populate_by_name": True}


class NHLBroadcast(BaseModel):
    """NHL game broadcast (TV network carrying the game)."""

    network: str  # e.g. "ESPN", "SN", "TVAS", "FDSNSO"
    market: str  # "N" (national) | "H" (home regional) | "A" (away regional)
    country_code: str = Field(alias="countryCode")  # "US" | "CA"

    model_config = {"populate_by_name": True}


class NHLSituation(BaseModel):
    """NHL game situation (power play, penalty, etc.)."""

    away_strength: int | str = Field(alias="awayStrength")
    home_strength: int | str = Field(alias="homeStrength")
    time_remaining: str | None = Field(alias="timeRemaining", default=None)
    away_description: list[str] | None = Field(alias="awayDescription", default=None)
    home_description: list[str] | None = Field(alias="homeDescription", default=None)

    model_config = {"populate_by_name": True}


class NHLGame(BaseModel):
    """NHL game information with teams, status, and live details."""

    id: int
    status: str  # 'scheduled' | 'live' | 'final'
    home_team: NHLTeam = Field(alias="homeTeam")
    away_team: NHLTeam = Field(alias="awayTeam")
    start_time: str = Field(alias="startTime")
    game_center_link: str = Field(alias="gameCenterLink")
    # Live game details (optional, only present when status == 'live')
    period: str | None = None
    time_remaining: str | None = Field(alias="timeRemaining", default=None)
    is_intermission: bool | None = Field(alias="isIntermission", default=None)
    # Final game outcome (optional, only present when status == 'final' and game went to OT/SO)
    outcome_type: str | None = Field(alias="outcomeType", default=None)
    # Situation (optional, power play info)
    situation: NHLSituation | None = None
    # TV broadcasts carrying the game (national + regional)
    broadcasts: list[NHLBroadcast] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class NHLScoresResponse(BaseModel):
    """Response model for NHL scores endpoint."""

    games: list[NHLGame]
    date: str
    live_game_count: int = Field(alias="liveGameCount")

    model_config = {"populate_by_name": True}
