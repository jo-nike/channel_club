"""ErsatzTV models for EPG channel and programme data."""

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.base import CamelModel


class EPGChannel(CamelModel):
    """ErsatzTV channel from M3U playlist."""

    id: str = Field(..., description="Unique channel identifier (tvg-id)")
    xmltv_id: str | None = Field(default=None, description="Original XMLTV identity")
    name: str = Field(..., description="Channel display name")
    stream_url: str = Field(description="HLS stream URL")
    logo_url: str | None = Field(default=None, description="Channel logo URL (proxied)")
    original_logo_url: str | None = Field(
        default=None, description="Original logo URL for backend fetching"
    )
    number: int | float | None = Field(
        default=None, description="Channel number for ordering (2.1 for a sub-channel)"
    )
    group: str | None = Field(default=None, description="Channel group/category")


class Programme(CamelModel):
    """ErsatzTV programme from XMLTV data."""

    id: str = Field(..., description="Unique programme identifier")
    channel_id: str = Field(description="References EPGChannel.id")
    title: str = Field(..., description="Programme title")
    description: str | None = Field(default=None, description="Programme description")
    start: datetime = Field(..., description="Start time (UTC)")
    stop: datetime = Field(..., description="End time (UTC)")
    category: list[str] | None = Field(default=None, description="Programme categories")
    season: int | None = Field(default=None, description="Season number")
    episode: int | None = Field(default=None, description="Episode number")
    year: str | None = Field(default=None, description="Release year")


class PublicEPGChannel(CamelModel):
    """An ErsatzTV channel as browsers see it, with no internal ErsatzTV URL.

    streamUrl is our tokenless proxy path (the frontend keys player resets on
    it and plays through getErsatzTVStreamUrl); originalLogoUrl is left out.
    """

    id: str
    xmltv_id: str | None = None
    name: str
    stream_url: str
    logo_url: str | None = None
    number: int | float | None = None
    group: str | None = None

    @classmethod
    def from_channel(cls, channel: EPGChannel) -> "PublicEPGChannel":
        return cls(
            id=channel.id,
            xmltv_id=channel.xmltv_id,
            name=channel.name,
            stream_url=f"/api/ersatztv/stream/{channel.id}",
            logo_url=channel.logo_url,
            number=channel.number,
            group=channel.group,
        )


class EPGChannelResponse(BaseModel):
    """Response for GET /api/ersatztv/channels."""

    channels: list[PublicEPGChannel]


class CurrentProgrammeResponse(CamelModel):
    """Response for GET /api/ersatztv/current/{channel_id}."""

    channel_id: str
    current: Programme | None = None
    next_up: Programme | None = None


class ProgrammeListResponse(CamelModel):
    """Response for GET /api/ersatztv/programmes/{channel_id}."""

    channel_id: str
    programmes: list[Programme]
