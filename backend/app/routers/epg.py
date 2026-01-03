"""EPG router for IPTV Viewer API."""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models.auth import TokenPayload
from app.models.epg import EPGResponse
from app.routers.auth_deps import get_current_user
from app.services.epg_service import EPGServiceError, get_epg_service

router = APIRouter(tags=["epg"])


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
    epg_service = get_epg_service()

    try:
        return await epg_service.get_now_playing(channel_id)
    except EPGServiceError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="EPG service unavailable",
        )
