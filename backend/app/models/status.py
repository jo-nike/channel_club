"""Status models for service health monitoring."""

from datetime import datetime

from pydantic import BaseModel, Field


class ServiceStatus(BaseModel):
    """Base model for service status.

    ``degraded`` means the service answers but part of the check failed (a
    rejected API key, a missing stats endpoint); ``error`` then gives the reason.
    """

    name: str
    online: bool
    degraded: bool = False
    last_checked: datetime = Field(alias="lastChecked")
    error: str | None = None

    model_config = {"populate_by_name": True}


class ErsatzTVSession(BaseModel):
    """Represents an active ErsatzTV transcoding session."""

    channel_number: int = Field(alias="channelNumber")
    channel_name: str | None = Field(default=None, alias="channelName")
    state: str | None = None
    buffer_seconds: float | None = Field(default=None, alias="bufferSeconds")
    streaming_mode: str | None = Field(default=None, alias="streamingMode")
    resolution: str | None = None
    video_codec: str | None = Field(default=None, alias="videoCodec")
    video_bitrate: int | None = Field(default=None, alias="videoBitrate")
    audio_codec: str | None = Field(default=None, alias="audioCodec")
    audio_bitrate: int | None = Field(default=None, alias="audioBitrate")

    model_config = {"populate_by_name": True}


class ErsatzTVStatus(ServiceStatus):
    """Status model for ErsatzTV service."""

    active_sessions: int = Field(default=0, alias="activeSessions")
    sessions: list[ErsatzTVSession] = Field(default_factory=list)


class DispatcharrStream(BaseModel):
    """Represents an active stream in Dispatcharr."""

    channel_id: str = Field(alias="channelId")
    stream_name: str = Field(alias="streamName")
    state: str = "active"
    client_count: int = Field(default=0, alias="clientCount")
    uptime: float = 0
    total_bytes: int = Field(default=0, alias="totalBytes")
    avg_bitrate: str = Field(default="", alias="avgBitrate")
    video_codec: str | None = Field(default=None, alias="videoCodec")
    resolution: str | None = None
    source_fps: float | None = Field(default=None, alias="sourceFps")

    model_config = {"populate_by_name": True}


class DispatchrrStatus(ServiceStatus):
    """Status model for Dispatcharr service."""

    active_streams: int = Field(default=0, alias="activeStreams")
    total_viewers: int = Field(default=0, alias="totalViewers")
    streams: list[DispatcharrStream] = Field(default_factory=list)


class EPGHealthStatus(ServiceStatus):
    """Status model for the guide data (XMLTV) cache.

    ``online`` means guide data is cached; ``stale`` means it is past its expiry
    because refreshes are failing. ``error`` is a short reason from the latest
    refresh ('HTTP 403', 'timeout', ...) and never contains the upstream URL.
    """

    stale: bool = False
    channel_count: int = Field(default=0, alias="channelCount")
    programme_count: int = Field(default=0, alias="programmeCount")
    last_attempt_at: datetime | None = Field(default=None, alias="lastAttemptAt")
    last_success_at: datetime | None = Field(default=None, alias="lastSuccessAt")
    next_retry_at: datetime | None = Field(default=None, alias="nextRetryAt")


class SystemStatusResponse(BaseModel):
    """Response model for GET /api/admin/status endpoint."""

    ersatztv: ErsatzTVStatus
    dispatcharr: DispatchrrStatus
    epg: EPGHealthStatus
    ersatztv_guide: EPGHealthStatus = Field(alias="ersatztvGuide")

    model_config = {"populate_by_name": True}
