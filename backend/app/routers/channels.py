"""Channels router for IPTV Viewer API."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.models.auth import TokenPayload
from app.models.channel import Channel
from app.routers.auth_deps import get_current_user
from app.services.dispatcharr import get_lineup, DispatchrrUnavailableError

router = APIRouter(tags=["channels"])


@router.get("/channels", response_model=list[Channel])
async def list_channels(
    current_user: TokenPayload = Depends(get_current_user),
) -> list[Channel]:
    """Get list of available channels from Dispatcharr.

    Requires JWT authentication. Returns channel list with transformed
    stream URLs pointing to the public streaming domain.

    Args:
        current_user: Authenticated user from JWT token.

    Returns:
        List of Channel objects.

    Raises:
        HTTPException: 503 if Dispatcharr is unavailable.
    """
    try:
        return await get_lineup()
    except DispatchrrUnavailableError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Channel service unavailable",
        )
