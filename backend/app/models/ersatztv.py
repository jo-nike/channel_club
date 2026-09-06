"""ErsatzTV models for EPG channel and programme data."""

from datetime import datetime

from pydantic import BaseModel, Field


class EPGChannel(BaseModel):
    """ErsatzTV channel from M3U playlist."""

    id: str = Field(..., description="Unique channel identifier (tvg-id)")
    xmltv_id: str | None = Field(
        default=None, alias="xmltvId", description="Original XMLTV identity"
    )
    name: str = Field(..., description="Channel display name")
    stream_url: str = Field(alias="streamUrl", description="HLS stream URL")
    logo_url: str | None = Field(
        default=None, alias="logoUrl", description="Channel logo URL (proxied)"
    )
    original_logo_url: str | None = Field(
        default=None, alias="originalLogoUrl", description="Original logo URL for backend fetching"
    )
    number: int | None = Field(default=None, description="Channel number for ordering")
    group: str | None = Field(default=None, description="Channel group/category")

    model_config = {"populate_by_name": True}


class Programme(BaseModel):
    """ErsatzTV programme from XMLTV data."""

    id: str = Field(..., description="Unique programme identifier")
    channel_id: str = Field(alias="channelId", description="References EPGChannel.id")
    title: str = Field(..., description="Programme title")
    description: str | None = Field(default=None, description="Programme description")
    start: datetime = Field(..., description="Start time (UTC)")
    stop: datetime = Field(..., description="End time (UTC)")
    category: list[str] | None = Field(default=None, description="Programme categories")
    season: int | None = Field(default=None, description="Season number")
    episode: int | None = Field(default=None, description="Episode number")
    year: str | None = Field(default=None, description="Release year")

    model_config = {"populate_by_name": True}


class EPGChannelResponse(BaseModel):
    """Response for GET /api/ersatztv/channels."""

    channels: list[EPGChannel]


class CurrentProgrammeResponse(BaseModel):
    """Response for GET /api/ersatztv/current/{channel_id}."""

    channel_id: str = Field(alias="channelId")
    current: Programme | None = None
    next_up: Programme | None = Field(default=None, alias="nextUp")

    model_config = {"populate_by_name": True}


class ProgrammeListResponse(BaseModel):
    """Response for GET /api/ersatztv/programmes/{channel_id}."""

    channel_id: str = Field(alias="channelId")
    programmes: list[Programme]

    model_config = {"populate_by_name": True}
