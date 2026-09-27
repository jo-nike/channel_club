"""Dispatcharr API client service."""

import asyncio
import time

import httpx
from loguru import logger

from app.config import settings
from app.models.channel import (
    Channel,
    ChannelGroupWithChannels,
    DispatchrrChannel,
    DispatchrrChannelGroup,
    DispatchrrFullChannel,
    GroupedChannelsResponse,
)

# Module-level logger with service context
log = logger.bind(service="dispatcharr")

# In-memory cache for grouped channels response.
# Dispatcharr's /api/channels/channels/ can be slow with large lineups; cache
# the assembled response for a short TTL so repeat opens of the admin modal
# are instant. A single in-flight lock prevents thundering herd on expiry.
_GROUPED_CACHE_TTL_SECONDS = 300
_grouped_cache: GroupedChannelsResponse | None = None
_grouped_cache_expires_at: float = 0.0
_grouped_cache_lock: asyncio.Lock | None = None


def _get_grouped_cache_lock() -> asyncio.Lock:
    global _grouped_cache_lock
    if _grouped_cache_lock is None:
        _grouped_cache_lock = asyncio.Lock()
    return _grouped_cache_lock


def invalidate_grouped_channels_cache() -> None:
    """Invalidate the grouped channels cache (e.g., on admin refresh)."""
    global _grouped_cache, _grouped_cache_expires_at
    _grouped_cache = None
    _grouped_cache_expires_at = 0.0
    log.debug("Grouped channels cache invalidated")


class DispatchrrUnavailableError(Exception):
    """Raised when Dispatcharr API is unreachable or returns an error."""

    pass


def extract_uuid(url: str) -> str:
    """Extract stream UUID from Dispatcharr URL.

    Args:
        url: Dispatcharr stream URL in format http://host/proxy/ts/stream/{uuid}

    Returns:
        The UUID portion of the URL (last path segment).
    """
    return url.split("/")[-1]


async def get_lineup() -> list[Channel]:
    """Fetch and transform channel lineup from Dispatcharr.

    Returns:
        List of Channel objects with transformed stream URLs.

    Raises:
        DispatchrrUnavailableError: If Dispatcharr is unreachable or returns error.
    """
    url = f"{settings.dispatcharr_url}/hdhr/lineup.json"
    log.debug("Fetching channel lineup from {}", url)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            response.raise_for_status()

            raw_channels = [DispatchrrChannel(**c) for c in response.json()]

            channels = [
                Channel(
                    id=extract_uuid(ch.url),
                    name=ch.guide_name,
                    stream_url=f"{settings.stream_base_url}/proxy/ts/stream/{extract_uuid(ch.url)}",
                    guide_id=ch.guide_id,
                )
                for ch in raw_channels
            ]

            log.info("Fetched {} channels successfully", len(channels))
            return channels
    except httpx.HTTPError as e:
        log.error("Failed to fetch channels: {}", str(e))
        raise DispatchrrUnavailableError(f"Failed to fetch channels: {e}") from e


def dispatcharr_auth_headers() -> dict[str, str]:
    """Build the Authorization header for authenticated Dispatcharr calls.

    Dispatcharr API keys do not expire, so there is no login round-trip, no
    cached token and nothing to refresh on a 401 — a 401 now means the key is
    wrong or has been revoked.

    Returns:
        Headers dict carrying the API key.

    Raises:
        DispatchrrUnavailableError: If no API key is configured.
    """
    if not settings.dispatcharr_api_key:
        raise DispatchrrUnavailableError("Dispatcharr API key not configured (DISPATCHARR_API_KEY)")
    return {"Authorization": f"ApiKey {settings.dispatcharr_api_key}"}


async def get_channel_groups() -> list[DispatchrrChannelGroup]:
    """Fetch channel groups from Dispatcharr.

    Returns:
        List of channel group objects.

    Raises:
        DispatchrrUnavailableError: If Dispatcharr is unreachable.
    """
    headers = dispatcharr_auth_headers()
    url = f"{settings.dispatcharr_url}/api/channels/groups/"
    log.debug("Fetching channel groups from {}", url)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            groups = [DispatchrrChannelGroup(**g) for g in response.json()]
            log.info("Fetched {} channel groups", len(groups))
            return groups
    except httpx.HTTPError as e:
        log.error("Failed to fetch channel groups: {}", str(e))
        raise DispatchrrUnavailableError(f"Failed to fetch channel groups: {e}") from e


async def get_channels_with_groups() -> list[DispatchrrFullChannel]:
    """Fetch full channel data with group IDs from Dispatcharr.

    Returns:
        List of full channel objects including group assignments.

    Raises:
        DispatchrrUnavailableError: If Dispatcharr is unreachable.
    """
    headers = dispatcharr_auth_headers()
    url = f"{settings.dispatcharr_url}/api/channels/channels/"
    log.debug("Fetching full channel data from {}", url)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            channels = [DispatchrrFullChannel(**c) for c in response.json()]
            log.info("Fetched {} channels with group data", len(channels))
            return channels
    except httpx.HTTPError as e:
        log.error("Failed to fetch channels with groups: {}", str(e))
        raise DispatchrrUnavailableError(f"Failed to fetch channels: {e}") from e


async def get_grouped_channels() -> GroupedChannelsResponse:
    """Fetch channels organized by groups.

    Combines channel groups and channels into a structured response
    where channels are nested under their respective groups. Result is
    cached in-memory for _GROUPED_CACHE_TTL_SECONDS.

    Returns:
        GroupedChannelsResponse with groups and ungrouped channels.

    Raises:
        DispatchrrUnavailableError: If Dispatcharr is unreachable.
    """
    global _grouped_cache, _grouped_cache_expires_at

    now = time.monotonic()
    if _grouped_cache is not None and now < _grouped_cache_expires_at:
        log.debug("Returning grouped channels from cache")
        return _grouped_cache

    async with _get_grouped_cache_lock():
        # Re-check after acquiring the lock (another request may have refreshed)
        now = time.monotonic()
        if _grouped_cache is not None and now < _grouped_cache_expires_at:
            return _grouped_cache

        result = await _build_grouped_channels()
        _grouped_cache = result
        _grouped_cache_expires_at = time.monotonic() + _GROUPED_CACHE_TTL_SECONDS
        return result


def format_channel_number(value: float | None) -> str | None:
    """Format a channel number the way Dispatcharr writes it into its outputs.

    Mirrors Dispatcharr's apps/channels/utils.format_channel_number: a whole
    number renders without a decimal part ("7" for 7.0), a fractional one as
    the float ("5.1"). Returns None when the channel has no number.
    """
    if value is None:
        return None
    if value == int(value):
        return str(int(value))
    return str(value)


def channel_logo_path(logo_id: int) -> str:
    """Our logo route for a Dispatcharr logo id (see routers/channels.py).

    Browsers only ever see this path: the upstream URL is rebuilt from the
    configured Dispatcharr origin and the integer id, never taken from a payload.
    """
    return f"/api/channels/logos/{logo_id}"


async def _build_grouped_channels() -> GroupedChannelsResponse:
    # Fetch groups and channels concurrently
    groups, channels = await asyncio.gather(get_channel_groups(), get_channels_with_groups())

    # Create a map of group_id -> group data with empty channel lists
    groups_map: dict[int, ChannelGroupWithChannels] = {}
    for g in groups:
        groups_map[g.id] = ChannelGroupWithChannels(
            id=g.id,
            name=g.name,
            channel_count=0,  # Will recalculate based on actual channels
            channels=[],
        )

    # Distribute channels to their groups
    ungrouped: list[Channel] = []
    for ch in channels:
        channel = Channel(
            id=ch.uuid,
            name=ch.name,
            stream_url=f"{settings.stream_base_url}/proxy/ts/stream/{ch.uuid}",
            # Dispatcharr's XMLTV (default tvg_id_source) and HDHR Guide_ID key a
            # channel by its number, falling back to the database id without one
            guide_id=format_channel_number(ch.channel_number) or str(ch.id),
            logo_url=channel_logo_path(ch.logo_id) if ch.logo_id is not None else None,
        )

        if ch.channel_group_id and ch.channel_group_id in groups_map:
            groups_map[ch.channel_group_id].channels.append(channel)
        else:
            ungrouped.append(channel)

    # Update channel counts and filter out empty groups
    result_groups: list[ChannelGroupWithChannels] = []
    for group in groups_map.values():
        if group.channels:
            group.channel_count = len(group.channels)
            result_groups.append(group)

    # Sort groups by name
    result_groups.sort(key=lambda g: g.name)

    log.info(
        "Organized {} channels into {} groups ({} ungrouped)",
        len(channels),
        len(result_groups),
        len(ungrouped),
    )

    return GroupedChannelsResponse(groups=result_groups, ungrouped=ungrouped)
