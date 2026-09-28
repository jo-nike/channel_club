"""ErsatzTV EPG service layer.

Unified service combining M3U channel data and XMLTV programme data.
Provides high-level API for querying channels and programmes.

Story: 7.4 - EPG Service Layer
"""

from datetime import UTC, datetime, timedelta

from loguru import logger

from app.config import settings
from app.models.ersatztv import EPGChannel, Programme
from app.services.ersatztv.m3u_parser import clear_cache as clear_m3u_cache
from app.services.ersatztv.m3u_parser import parse_m3u_playlist
from app.services.ersatztv.refresh import run_feed_lookup, shutdown_feed_executor
from app.services.ersatztv.xmltv_parser import clear_cache as clear_xmltv_cache
from app.services.ersatztv.xmltv_parser import guide
from app.services.logo_proxy import reset_logo_cache

# Module-level logger with service context
log = logger.bind(service="ersatztv")


def get_channels() -> list[EPGChannel]:
    """
    Get all ErsatzTV channels with logo URLs rewritten to proxy.

    Returns:
        List of EPGChannel objects from M3U playlist

    Note:
        Logo URLs are rewritten from ErsatzTV URLs to /api/ersatztv/logos/{channel_id}
        to avoid mixed content issues (HTTPS app -> HTTP ErsatzTV).
    """
    channels = parse_m3u_playlist()

    # Rewrite logo URLs to use proxy
    ersatztv_base = settings.ersatztv_base_url
    for channel in channels:
        if channel.logo_url and channel.logo_url.startswith(ersatztv_base):
            # Store original for backend fetching
            channel.original_logo_url = channel.logo_url
            # Rewrite to proxy endpoint
            channel.logo_url = f"/api/ersatztv/logos/{channel.id}"

    return channels


def get_channel_by_id(channel_id: str) -> EPGChannel | None:
    """
    Get a specific channel by ID.

    Args:
        channel_id: Channel identifier

    Returns:
        EPGChannel if found, None otherwise
    """
    log.debug("Looking up channel by ID: {}", channel_id)
    channels = get_channels()
    for channel in channels:
        if channel.id == channel_id:
            log.debug("Found channel: {}", channel.name)
            return channel
    log.debug("Channel not found: {}", channel_id)
    return None


async def _schedule_for_channel(channel_id: str) -> tuple[str, list[Programme]]:
    """A channel's XMLTV identity from the M3U, and that identity's programmes."""
    # Channel selection IDs are unique; the provider's XMLTV identity may repeat.
    try:
        channel = await run_feed_lookup(get_channel_by_id, channel_id)
    except Exception:
        channel = None  # A catalog outage must not disable already-known XMLTV IDs.
    identity = (channel.xmltv_id if channel else None) or channel_id
    return identity, await guide.programmes(identity)


def _for_channel(programme: Programme, identity: str, channel_id: str) -> Programme:
    """A programme found under a shared XMLTV identity, keyed to the selected channel."""
    if identity == channel_id:
        return programme
    return programme.model_copy(
        update={
            "channel_id": channel_id,
            "id": f"{channel_id}_{int(programme.start.timestamp())}",
        }
    )


async def get_current_programme(channel_id: str) -> tuple[Programme | None, Programme | None]:
    """
    Get current and next programme for a channel.

    Args:
        channel_id: Channel identifier

    Returns:
        Tuple of (current_programme, next_programme), either may be None.
        Next is the first programme starting once the current one ends.
    """
    identity, programmes = await _schedule_for_channel(channel_id)
    current, next_up = guide.now_and_next(programmes, datetime.now(UTC))
    return (
        _for_channel(current, identity, channel_id) if current else None,
        _for_channel(next_up, identity, channel_id) if next_up else None,
    )


async def get_programmes_by_channel(channel_id: str, hours: int = 6) -> list[Programme]:
    """
    Get programmes for a channel within time window.

    The window opens an hour before now, so the guide grid (which starts up
    to an hour early) can draw the programmes that just finished.

    Args:
        channel_id: Channel identifier
        hours: Number of hours to look ahead (default: 6)

    Returns:
        List of programmes that overlap [now - 1 hour, now + hours), sorted
        by start time
    """
    identity, programmes = await _schedule_for_channel(channel_id)
    now = datetime.now(UTC)
    in_window = guide.in_window(programmes, now - timedelta(hours=1), now + timedelta(hours=hours))
    return [_for_channel(programme, identity, channel_id) for programme in in_window]


async def get_upcoming_programmes(
    channel_id: str,
    hours: int = 6,
    limit: int | None = None,
) -> list[Programme]:
    """
    Get upcoming (future only) programmes for a channel.

    Args:
        channel_id: Channel identifier
        hours: Number of hours to look ahead
        limit: Maximum number of programmes to return

    Returns:
        List of upcoming programmes sorted by start time
    """
    identity, programmes = await _schedule_for_channel(channel_id)
    now = datetime.now(UTC)
    upcoming = guide.starting_between(programmes, now, now + timedelta(hours=hours))
    if limit:
        upcoming = upcoming[:limit]
    return [_for_channel(programme, identity, channel_id) for programme in upcoming]


def refresh_all() -> None:
    """Force refresh both M3U and XMLTV caches."""
    clear_m3u_cache()
    clear_xmltv_cache()
    log.info("ErsatzTV EPG caches cleared, data will refresh on next request")


def reset_state() -> None:
    """Empty both feed caches, forget their failures and drop the feeds executor (tests).

    Also empties the logo cache the ErsatzTV and Dispatcharr logo routes share.
    """
    parse_m3u_playlist.reset()
    guide.reset()
    shutdown_feed_executor()
    reset_logo_cache()
