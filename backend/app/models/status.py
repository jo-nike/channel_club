"""Status models for service health monitoring."""

from datetime import datetime

from pydantic import Field

from app.models.base import CamelModel


class ServiceStatus(CamelModel):
    """Base model for service status.

    ``degraded`` means the service answers but part of the check failed (a
    rejected API key, a missing stats endpoint); ``error`` then gives the reason.
    """

    name: str
    online: bool
    degraded: bool = False
    last_checked: datetime
    error: str | None = None


class ErsatzTVSession(CamelModel):
    """Represents an active ErsatzTV transcoding session."""

    channel_number: int
    channel_name: str | None = None
    state: str | None = None
    buffer_seconds: float | None = None
    streaming_mode: str | None = None
    resolution: str | None = None
    video_codec: str | None = None
    video_bitrate: int | None = None
    audio_codec: str | None = None
    audio_bitrate: int | None = None


class ErsatzTVStatus(ServiceStatus):
    """Status model for ErsatzTV service."""

    active_sessions: int = 0
    sessions: list[ErsatzTVSession] = Field(default_factory=list)


class DispatcharrStream(CamelModel):
    """Represents an active stream in Dispatcharr."""

    channel_id: str
    stream_name: str
    state: str = "active"
    client_count: int = 0
    uptime: float = 0
    total_bytes: int = 0
    avg_bitrate: str = ""
    video_codec: str | None = None
    resolution: str | None = None
    source_fps: float | None = None


class DispatchrrStatus(ServiceStatus):
    """Status model for Dispatcharr service."""

    active_streams: int = 0
    total_viewers: int = 0
    streams: list[DispatcharrStream] = Field(default_factory=list)


class EPGHealthStatus(ServiceStatus):
    """Status model for the guide data (XMLTV) cache.

    ``online`` means guide data is cached; ``stale`` means it is past its expiry
    because refreshes are failing. ``error`` is a short reason from the latest
    refresh ('HTTP 403', 'timeout', ...) and never contains the upstream URL.
    """

    stale: bool = False
    channel_count: int = 0
    programme_count: int = 0
    last_attempt_at: datetime | None = None
    last_success_at: datetime | None = None
    next_retry_at: datetime | None = None


class SystemStatusResponse(CamelModel):
    """Response model for GET /api/admin/status endpoint."""

    ersatztv: ErsatzTVStatus
    dispatcharr: DispatchrrStatus
    epg: EPGHealthStatus
    ersatztv_guide: EPGHealthStatus
