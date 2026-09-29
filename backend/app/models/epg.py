"""EPG (Electronic Program Guide) models for Channel Club API."""

from datetime import datetime

from app.models.base import CamelModel


class Program(CamelModel):
    """Program information from EPG data."""

    title: str
    start_time: datetime
    end_time: datetime
    description: str | None = None


class NowPlayingBulkResponse(CamelModel):
    """Response for GET /api/epg/now-playing/all."""

    now_playing: dict[str, Program]


class EPGResponse(CamelModel):
    """Response model for EPG now-playing endpoint."""

    channel_id: str
    current_program: Program | None
    next_program: Program | None = None


class EPGProgrammesResponse(CamelModel):
    """Response for GET /api/epg/programmes."""

    channel_id: str
    programmes: list[Program]
