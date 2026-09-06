"""Channels router for Channel Club API."""

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger

from app.models.auth import TokenPayload
from app.models.channel import (
    Channel,
    CurrentChannelResponse,
    GroupedChannelsResponse,
    SetChannelRequest,
)
from app.routers.auth_deps import get_current_user, require_admin, require_channel_control
from app.services import channel_state
from app.services.dispatcharr import DispatchrrUnavailableError, get_grouped_channels, get_lineup
from app.services.media_source import resolve_media_channel

router = APIRouter(tags=["channels"])
log = logger.bind(router="channels")


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
    log.debug("GET /channels request")
    try:
        channels = await get_lineup()
        log.debug("Returning {} channels", len(channels))
        return channels
    except DispatchrrUnavailableError:
        log.warning("Channel service unavailable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Channel service unavailable",
        ) from None


@router.get("/channels/grouped", response_model=GroupedChannelsResponse)
async def list_grouped_channels(
    current_user: TokenPayload = Depends(get_current_user),
) -> GroupedChannelsResponse:
    """Get channels organized by groups from Dispatcharr.

    Requires JWT authentication. Returns channels organized into their
    respective groups, with ungrouped channels in a separate list.

    Args:
        current_user: Authenticated user from JWT token.

    Returns:
        GroupedChannelsResponse with groups and ungrouped channels.

    Raises:
        HTTPException: 503 if Dispatcharr is unavailable.
    """
    log.debug("GET /channels/grouped request")
    try:
        grouped = await get_grouped_channels()
        total_channels = sum(len(g.channels) for g in grouped.groups) + len(grouped.ungrouped)
        log.debug(
            "Returning {} groups with {} total channels",
            len(grouped.groups),
            total_channels,
        )
        return grouped
    except DispatchrrUnavailableError as e:
        log.warning("Channel service unavailable: {}", str(e))
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
    log.debug("GET /channels/current request")
    channel = channel_state.get_current_channel()
    return CurrentChannelResponse(current_channel=channel)


@router.put("/channels/current", response_model=Channel)
async def set_current_channel(
    request: SetChannelRequest,
    current_user: TokenPayload = Depends(require_channel_control),
) -> Channel:
    """Set the current channel.

    Requires admin role, unless an admin has enabled the user_channel_selection
    setting, in which case any authenticated user may change the channel.
    Updates the current channel state and broadcasts to all WebSocket clients.

    Args:
        request: Channel data to set.
        current_user: Authenticated user allowed to change the channel.

    Returns:
        The updated channel.
    """
    log.info("User {} changing channel to '{}'", current_user.sub, request.name)
    channel = (await resolve_media_channel(request.id)).channel
    return await channel_state.set_current_channel(channel, user=current_user.sub)


@router.delete("/channels/current")
async def clear_current_channel(
    current_user: TokenPayload = Depends(require_admin),
) -> dict:
    """Clear the current channel selection (admin only).

    Requires admin role. Clears the current channel state and broadcasts
    to all WebSocket clients.

    Args:
        current_user: Authenticated admin user from JWT token.

    Returns:
        Status confirmation dict.
    """
    log.info("Admin {} clearing current channel", current_user.sub)
    await channel_state.clear_current_channel_async()
    return {"status": "cleared"}
