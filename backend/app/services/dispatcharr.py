"""Dispatcharr API client service."""

import asyncio
from typing import Any

import httpx
from loguru import logger
from pydantic import ValidationError

from app.config import settings
from app.models.channel import (
    Channel,
    ChannelGroupWithChannels,
    DispatchrrChannelGroup,
    DispatchrrFullChannel,
    GroupedChannelsResponse,
)
from app.services.cached_fetch import CachedFetch
from app.services.epg_service import get_epg_service
from app.services.logo_proxy import LOGO_CACHE, LogoUnavailableError, fetch_logo
from app.services.tls import SSL_CONTEXT

# Module-level logger with service context
log = logger.bind(service="dispatcharr")

# Grouped channels cache TTL. Dispatcharr's /api/channels/channels/ can be slow
# with large lineups, and every channel switch and uncached logo resolves
# through the catalogue, so it is cached (see _grouped_cache below).
_GROUPED_CACHE_TTL_SECONDS = 300

# Dispatcharr sits behind a WireGuard tunnel; a dropped tunnel fails at connect,
# so that phase gets a short budget.
_CATALOGUE_TIMEOUT = httpx.Timeout(10, connect=3)

# Channel logos live in the shared LOGO_CACHE under this prefix. A logo
# Dispatcharr answers 404 for is remembered for one catalogue TTL.
_LOGO_KEY_PREFIX = "dispatcharr:"


class DispatchrrUnavailableError(Exception):
    """Raised when Dispatcharr API is unreachable or returns an error."""

    pass


# The assembled grouped catalogue, served stale while Dispatcharr is down
_grouped_cache: CachedFetch[GroupedChannelsResponse] = CachedFetch(
    "grouped channels",
    lambda: _build_grouped_channels(),
    ttl=_GROUPED_CACHE_TTL_SECONDS,
    error=DispatchrrUnavailableError,
)


def catalogue_failing() -> bool:
    """Whether the latest catalogue fetch failed; local state only, never fetches."""
    return _grouped_cache._last_error is not None


def peek_grouped_channels() -> GroupedChannelsResponse | None:
    """The cached catalogue as it is, or None if it never loaded; never fetches or waits."""
    return _grouped_cache.peek()


def refresh_catalogue_if_due() -> None:
    """Start one background catalogue refresh if it is expired or missing; never waits."""
    _grouped_cache.refresh_if_due()


class ChannelLogoNotFoundError(Exception):
    """Raised when no channel in the catalogue uses the requested logo."""


def extract_uuid(url: str) -> str:
    """Extract stream UUID from Dispatcharr URL.

    Args:
        url: Dispatcharr stream URL in format http://host/proxy/ts/stream/{uuid}

    Returns:
        The UUID portion of the URL (last path segment).
    """
    return url.split("/")[-1]


def _json_list(response: httpx.Response) -> list[Any]:
    """The response's JSON array (an HTML login page or a paginated dict is not one)."""
    payload = response.json()
    if not isinstance(payload, list):
        raise TypeError(f"expected a JSON list, got {type(payload).__name__}")
    return payload


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
        async with httpx.AsyncClient(timeout=_CATALOGUE_TIMEOUT, verify=SSL_CONTEXT) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            groups = [DispatchrrChannelGroup(**g) for g in _json_list(response)]
            log.info("Fetched {} channel groups", len(groups))
            return groups
    except httpx.HTTPError as e:
        log.error("Failed to fetch channel groups: {}", str(e))
        raise DispatchrrUnavailableError(f"Failed to fetch channel groups: {e}") from e
    except (ValueError, TypeError, ValidationError) as e:
        log.error("Unexpected channel groups payload: {}", str(e))
        raise DispatchrrUnavailableError(f"Unexpected channel groups payload: {e}") from e


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
        async with httpx.AsyncClient(timeout=_CATALOGUE_TIMEOUT, verify=SSL_CONTEXT) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            channels = [DispatchrrFullChannel(**c) for c in _json_list(response)]
            log.info("Fetched {} channels with group data", len(channels))
            return channels
    except httpx.HTTPError as e:
        log.error("Failed to fetch channels with groups: {}", str(e))
        raise DispatchrrUnavailableError(f"Failed to fetch channels: {e}") from e
    except (ValueError, TypeError, ValidationError) as e:
        log.error("Unexpected channels payload: {}", str(e))
        raise DispatchrrUnavailableError(f"Unexpected channels payload: {e}") from e


async def get_grouped_channels() -> GroupedChannelsResponse:
    """Fetch channels organized by groups.

    Combines channel groups and channels into a structured response
    where channels are nested under their respective groups. Result is
    cached in-memory for _GROUPED_CACHE_TTL_SECONDS; after that, and while
    Dispatcharr is down, the last good catalogue is served while a background
    refresh runs.

    Returns:
        GroupedChannelsResponse with groups and ungrouped channels.

    Raises:
        DispatchrrUnavailableError: If Dispatcharr is unreachable and nothing is cached.
    """
    return await _grouped_cache.get()


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

    # A renumbering changes the guide ids, which leaves the cached guide stale
    get_epg_service().note_guide_ids(
        [*(c.guide_id for g in result_groups for c in g.channels), *(c.guide_id for c in ungrouped)]
    )

    return GroupedChannelsResponse(groups=result_groups, ungrouped=ungrouped)


async def get_channel_logo(logo_id: int) -> tuple[bytes, str]:
    """Fetch a channel logo image from Dispatcharr, cached in memory.

    The upstream URL is built from the configured Dispatcharr origin and the
    integer id (Dispatcharr's LogoViewSet.cache action), and only that origin is
    trusted, redirects included, so the API key can't leave it. Only logos used
    by a channel in the catalogue are served, so the unauthenticated route can't
    be used to walk Dispatcharr's whole logo table.

    Returns:
        The image bytes and their checked raster content type.

    Raises:
        ChannelLogoNotFoundError: If no channel in the catalogue uses this logo.
        LogoNotFoundError: If Dispatcharr answers 404 for it (remembered for
            for one catalogue TTL).
        DispatchrrUnavailableError: If Dispatcharr can't serve it as a raster image.
    """

    key = f"{_LOGO_KEY_PREFIX}{logo_id}"
    try:
        cached = LOGO_CACHE.cached(key)
    except LogoUnavailableError as e:
        raise DispatchrrUnavailableError(str(e)) from e
    if cached is not None:
        return cached

    # Only logos a catalogue channel uses; checked before LOGO_CACHE.get, which
    # keeps a lock per key, so unknown ids can't grow the cache's lock map
    grouped = await get_grouped_channels()
    path = channel_logo_path(logo_id)
    channels = [*(c for g in grouped.groups for c in g.channels), *grouped.ungrouped]
    if not any(channel.logo_url == path for channel in channels):
        raise ChannelLogoNotFoundError(f"No channel uses logo {logo_id}")

    async def fetch() -> tuple[bytes, str]:
        url = f"{settings.dispatcharr_url}/api/channels/logos/{logo_id}/cache/"
        async with httpx.AsyncClient(
            follow_redirects=False, timeout=10.0, verify=SSL_CONTEXT
        ) as client:
            return await fetch_logo(
                client,
                url,
                trusted_origins=[settings.dispatcharr_url],
                headers=dispatcharr_auth_headers(),
            )

    try:
        return await LOGO_CACHE.get(key, fetch, not_found_ttl=_GROUPED_CACHE_TTL_SECONDS)
    except LogoUnavailableError as e:
        raise DispatchrrUnavailableError(str(e)) from e
