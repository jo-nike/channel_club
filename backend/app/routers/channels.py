"""Channels router for IPTV Viewer API."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.models.auth import TokenPayload
from app.models.channel import Channel, CurrentChannelResponse, SetChannelRequest
from app.routers.auth_deps import get_current_user, require_admin
from app.services import channel_state
from app.services.dispatcharr import DispatchrrUnavailableError, get_lineup

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
        ) from None


@router.get("/channels/current", response_model=CurrentChannelResponse)
async def get_current_channel(
    current_user: TokenPayload = Depends(get_current_user),
) -> CurrentChannelResponse:
    """Get the currently selected channel.

    Requires JWT authentication. Returns the current channel or null if none selected.

    Args:
        current_user: Authenticated user from JWT token.

    Returns:
        CurrentChannelResponse with current channel or null.
    """
    channel = channel_state.get_current_channel()
    return CurrentChannelResponse(current_channel=channel)


@router.put("/channels/current", response_model=Channel)
async def set_current_channel(
    request: SetChannelRequest,
    current_user: TokenPayload = Depends(require_admin),
) -> Channel:
    """Set the current channel (admin only).

    Requires admin role. Updates the current channel state and broadcasts
    to all WebSocket clients.

    Args:
        request: Channel data to set.
        current_user: Authenticated admin user from JWT token.

    Returns:
        The updated channel.
    """
    channel = Channel(
        id=request.id,
        name=request.name,
        stream_url=request.stream_url,
    )
    return await channel_state.set_current_channel(channel)
