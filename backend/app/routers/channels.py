"""Channels router for Channel Club API."""

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status
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
from app.services.dispatcharr import (
    ChannelLogoNotFoundError,
    DispatchrrUnavailableError,
    get_channel_logo,
    get_grouped_channels,
)
from app.services.logo_proxy import (
    LOGO_CACHE_CONTROL,
    LOGO_NOT_FOUND_CACHE_CONTROL,
    LogoNotFoundError,
)
from app.services.media_source import resolve_media_channel

router = APIRouter(tags=["channels"])
log = logger.bind(router="channels")


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


@router.get("/channels/logos/{logo_id}")
async def get_channel_logo_image(
    logo_id: int = Path(..., ge=1),
    # No auth required, like /api/ersatztv/logos: browser img tags can't send
    # the JWT. Only logos used by a catalogue channel are served, and cached.
) -> Response:
    """Proxy a Dispatcharr channel logo as a checked raster image.

    Args:
        logo_id: Dispatcharr's integer logo id, as carried in Channel.logoUrl.

    Returns:
        The logo image.

    Raises:
        HTTPException: 404 if no channel uses this logo or Dispatcharr has none,
            503 if it can't be served.
    """
    log.debug("GET /channels/logos/{} request", logo_id)
    try:
        body, content_type = await get_channel_logo(logo_id)
    except ChannelLogoNotFoundError:
        raise HTTPException(status_code=404, detail="No logo available") from None
    except LogoNotFoundError:
        # Dispatcharr has no such image; browsers may keep that answer a while
        raise HTTPException(
            status_code=404,
            detail="No logo available",
            headers={"Cache-Control": LOGO_NOT_FOUND_CACHE_CONTROL},
        ) from None
    except DispatchrrUnavailableError:
        raise HTTPException(status_code=503, detail="Logo unavailable") from None

    return Response(
        body,
        media_type=content_type,
        headers={
            "Cache-Control": LOGO_CACHE_CONTROL,
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )


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
    log.debug("User {} changing channel to '{}'", current_user.sub, request.name)
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
    await channel_state.clear_current_channel_async(user=current_user.sub)
    return {"status": "cleared"}
