"""EPG router for IPTV Viewer API."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger

from app.models.auth import TokenPayload
from app.models.epg import EPGResponse, NowPlayingBulkResponse
from app.routers.auth_deps import get_current_user
from app.services.epg_service import EPGServiceError, get_epg_service

router = APIRouter(tags=["epg"])
log = logger.bind(router="epg")


@router.get("/epg/now-playing/all", response_model=NowPlayingBulkResponse)
async def get_now_playing_all(
    current_user: TokenPayload = Depends(get_current_user),
) -> NowPlayingBulkResponse:
    """Get the currently airing program for every channel.

    Requires JWT authentication. Lets a channel list show what is on each
    channel without one request per channel.

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

    try:
        now_playing = await epg_service.get_now_playing_bulk()
        log.debug("EPG bulk response with {} channels on air", len(now_playing))
        return NowPlayingBulkResponse(now_playing=now_playing)
    except EPGServiceError:
        log.warning("EPG service unavailable for bulk now-playing")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="EPG service unavailable",
        ) from None


@router.get("/epg/now-playing", response_model=EPGResponse)
async def get_now_playing(
    channel_id: str = Query(..., description="Channel UUID to get EPG data for"),
    current_user: TokenPayload = Depends(get_current_user),
) -> EPGResponse:
    """Get current and next program for a channel.

    Requires JWT authentication. Returns the currently playing program
    and optionally the next program for the specified channel.

    Args:
        channel_id: UUID of the channel to look up.
        current_user: Authenticated user from JWT token.

    Returns:
        EPGResponse with current and next program info.

    Raises:
        HTTPException: 503 if EPG service is unavailable.
    """
    log.debug("EPG now-playing request for channel_id: {}", channel_id)
    epg_service = get_epg_service()

    try:
        result = await epg_service.get_now_playing(channel_id)
        log.debug("EPG response data returned for channel: {}", channel_id)
        return result
    except EPGServiceError:
        log.warning("EPG service unavailable for channel: {}", channel_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="EPG service unavailable",
        ) from None
