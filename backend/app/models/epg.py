"""EPG (Electronic Program Guide) models for IPTV Viewer API."""

from datetime import datetime

from pydantic import BaseModel, Field


class Program(BaseModel):
    """Program information from EPG data."""

    title: str
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    description: str | None = None

    model_config = {"populate_by_name": True}


class NowPlayingBulkResponse(BaseModel):
    """Response for GET /api/epg/now-playing/all."""

    now_playing: dict[str, Program] = Field(alias="nowPlaying")

    model_config = {"populate_by_name": True}


class EPGResponse(BaseModel):
    """Response model for EPG now-playing endpoint."""

    channel_id: str = Field(alias="channelId")
    current_program: Program | None = Field(alias="currentProgram")
    next_program: Program | None = Field(alias="nextProgram", default=None)

    model_config = {"populate_by_name": True}
