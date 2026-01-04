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
from app.services.ersatztv.xmltv_parser import clear_cache as clear_xmltv_cache
from app.services.ersatztv.xmltv_parser import parse_xmltv

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


def get_current_programme(channel_id: str) -> tuple[Programme | None, Programme | None]:
    """
    Get current and next programme for a channel.

    Args:
        channel_id: Channel identifier

    Returns:
        Tuple of (current_programme, next_programme), either may be None
    """
    programmes = parse_xmltv()
    now = datetime.now(UTC)

    current = None
    next_up = None

    # Find current programme (start <= now < stop)
    for prog in programmes:
        if prog.channel_id == channel_id and prog.start <= now < prog.stop:
            current = prog
            break

    # Find next programme (start >= now, first one after current)
    channel_progs = sorted(
        [p for p in programmes if p.channel_id == channel_id and p.start >= now],
        key=lambda p: p.start,
    )

    # If we have a current programme, next is first after current ends
    if current and channel_progs:
        for prog in channel_progs:
            if prog.start >= current.stop:
                next_up = prog
                break
    elif channel_progs:
        next_up = channel_progs[0]

    return current, next_up


def get_programmes_by_channel(channel_id: str, hours: int = 6) -> list[Programme]:
    """
    Get programmes for a channel within time window.

    Args:
        channel_id: Channel identifier
        hours: Number of hours to look ahead (default: 6)

    Returns:
        List of programmes sorted by start time
    """
    programmes = parse_xmltv()
    now = datetime.now(UTC)
    end_time = now + timedelta(hours=hours)

    # Include currently airing + upcoming within window
    result = []
    for prog in programmes:
        if prog.channel_id != channel_id:
            continue
        # Include if: currently airing OR starts within window
        if (prog.start <= now < prog.stop) or (now <= prog.start < end_time):
            result.append(prog)

    return sorted(result, key=lambda p: p.start)


def get_upcoming_programmes(
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
    programmes = parse_xmltv()
    now = datetime.now(UTC)
    end_time = now + timedelta(hours=hours)

    upcoming = [
        p
        for p in programmes
        if p.channel_id == channel_id and p.start >= now and p.start < end_time
    ]

    upcoming.sort(key=lambda p: p.start)

    if limit:
        return upcoming[:limit]
    return upcoming


def refresh_all() -> None:
    """Force refresh both M3U and XMLTV caches."""
    clear_m3u_cache()
    clear_xmltv_cache()
    log.info("ErsatzTV EPG caches cleared, data will refresh on next request")
