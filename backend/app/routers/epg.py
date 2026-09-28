"""EPG router for Channel Club API."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger

from app.models.auth import TokenPayload
from app.models.channel import Channel
from app.models.epg import EPGProgrammesResponse, EPGResponse, NowPlayingBulkResponse
from app.routers.auth_deps import get_current_user
from app.services.dispatcharr import DispatchrrUnavailableError, get_grouped_channels
from app.services.epg_service import EPGService, EPGServiceError, get_epg_service

router = APIRouter(tags=["epg"])
log = logger.bind(router="epg")

# The retry deadline of the last 'unavailable' warning, so each backoff window
# warns once instead of once per request
_warned_retry_at: datetime | None = None


def clear_unavailable_warning() -> None:
    """Forget the last 'unavailable' warning (tests)."""
    global _warned_retry_at
    _warned_retry_at = None


def _log_unavailable(epg_service: EPGService, message: str, *args: object) -> None:
    """Log a guide 503 at DEBUG, plus one WARNING with the cause per backoff window."""
    global _warned_retry_at
    log.debug(message, *args)
    health = epg_service.get_health()
    if health.next_retry_at is not None and health.next_retry_at == _warned_retry_at:
        return
    _warned_retry_at = health.next_retry_at
    log.warning(
        "EPG service unavailable: {} (next retry at {})", health.error, health.next_retry_at
    )


@router.get("/epg/now-playing/all", response_model=NowPlayingBulkResponse)
async def get_now_playing_all(
    current_user: TokenPayload = Depends(get_current_user),
) -> NowPlayingBulkResponse:
    """Get the currently airing program for every channel.

    Requires JWT authentication. Lets a channel list show what is on each
    channel without one request per channel.

    The grouped channel catalogue (the list the channel picker shows) is
    resolved by guide id with the same display-name fallback as the single
    lookup. When the catalogue is unavailable, only XMLTV ids are returned.

    Args:
        current_user: Authenticated user from JWT token.

    Returns:
        NowPlayingBulkResponse mapping channel id to its current program.
        Channels with nothing on air are omitted.

    Raises:
        HTTPException: 503 if EPG service is unavailable.
    """
    log.debug("EPG bulk now-playing request")
    epg_service = get_epg_service()

    channels: list[Channel] = []
    try:
        grouped = await get_grouped_channels()
        channels = [ch for group in grouped.groups for ch in group.channels] + grouped.ungrouped
    except DispatchrrUnavailableError:
        log.warning("Channel catalogue unavailable; bulk now-playing keyed by XMLTV id only")

    try:
        now_playing = await epg_service.get_now_playing_bulk(channels)
        log.debug("EPG bulk response with {} channels on air", len(now_playing))
        return NowPlayingBulkResponse(now_playing=now_playing)
    except EPGServiceError:
        _log_unavailable(epg_service, "EPG service unavailable for bulk now-playing")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="EPG service unavailable",
        ) from None


@router.get("/epg/now-playing", response_model=EPGResponse)
async def get_now_playing(
    channel_id: str = Query(..., description="Channel UUID to get EPG data for"),
    channel_name: str | None = Query(
        None,
        max_length=256,
        description="Channel name, matched to an XMLTV display name when the id has no data",
    ),
    current_user: TokenPayload = Depends(get_current_user),
) -> EPGResponse:
    """Get current and next program for a channel.

    Requires JWT authentication. Returns the currently playing program
    and optionally the next program for the specified channel.

    Args:
        channel_id: UUID of the channel to look up.
        channel_name: Optional channel name to fall back on.
        current_user: Authenticated user from JWT token.

    Returns:
        EPGResponse with current and next program info.

    Raises:
        HTTPException: 503 if EPG service is unavailable.
    """
    log.debug("EPG now-playing request for channel_id: {}", channel_id)
    epg_service = get_epg_service()

    try:
        result = await epg_service.get_now_playing(channel_id, channel_name=channel_name)
        log.debug("EPG response data returned for channel: {}", channel_id)
        return result
    except EPGServiceError:
        _log_unavailable(epg_service, "EPG service unavailable for channel: {}", channel_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="EPG service unavailable",
        ) from None


@router.get("/epg/programmes", response_model=EPGProgrammesResponse)
async def get_programmes(
    channel_id: str = Query(..., description="Guide id of the channel to get the schedule for"),
    hours: int = Query(12, ge=1, le=48, description="How many hours ahead of now to include"),
    channel_name: str | None = Query(
        None,
        max_length=256,
        description="Channel name, matched to an XMLTV display name when the id has no data",
    ),
    current_user: TokenPayload = Depends(get_current_user),
) -> EPGProgrammesResponse:
    """Get a channel's schedule from the XMLTV guide.

    Requires JWT authentication. Returns the programmes that end after
    30 minutes ago and start within the next `hours` hours, in start order.

    Args:
        channel_id: Guide id of the channel to look up.
        hours: How many hours ahead of now to include (1-48).
        channel_name: Optional channel name to fall back on.
        current_user: Authenticated user from JWT token.

    Returns:
        EPGProgrammesResponse with the channel's programmes in the window.

    Raises:
        HTTPException: 503 if EPG service is unavailable.
    """
    log.debug("EPG programmes request for channel_id: {} ({}h)", channel_id, hours)
    epg_service = get_epg_service()

    try:
        result = await epg_service.get_programmes(channel_id, hours, channel_name=channel_name)
        log.debug("EPG programmes returned {} for channel: {}", len(result.programmes), channel_id)
        return result
    except EPGServiceError:
        _log_unavailable(
            epg_service, "EPG service unavailable for programmes of channel: {}", channel_id
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="EPG service unavailable",
        ) from None
