"""ErsatzTV M3U playlist parser

Parses M3U playlists with extended metadata attributes.
Implements 1-hour TTL caching with graceful fallback.

Story: 7.2 - M3U Parser Service
"""

import re
from datetime import datetime, timedelta

from loguru import logger

from app.config import settings
from app.models.ersatztv import EPGChannel
from app.services.bounded_http import fetch_feed
from app.services.ersatztv.refresh import serialized_refresh

# Module-level logger with service context
log = logger.bind(service="ersatztv")


# Module-level cache
_cache: dict = {
    "channels": [],
    "timestamp": None,
    "last_successful_fetch": None,
}
CACHE_TTL_SECONDS = 3600  # 1 hour


def _is_cache_expired() -> bool:
    """Check if cache is expired (> 1 hour old)."""
    if _cache["timestamp"] is None:
        return True
    age = datetime.now() - _cache["timestamp"]
    return age.total_seconds() > CACHE_TTL_SECONDS


@serialized_refresh
def parse_m3u_playlist() -> list[EPGChannel]:
    """
    Parse ErsatzTV M3U playlist and return list of channels.

    Fetches M3U from configured URL, parses EXTINF metadata,
    and returns EPGChannel objects. Results are cached for 1 hour.

    Returns:
        List of EPGChannel objects parsed from M3U playlist

    Raises:
        Exception: If fetch fails and no cached data available
    """
    # Check cache
    if _cache.get("retry_at") and datetime.now() < _cache["retry_at"]:
        if _cache["last_successful_fetch"] is not None:
            return _cache["channels"]
        raise RuntimeError("Feed temporarily unavailable")
    if not _is_cache_expired():
        log.debug("Cache hit for M3U data")
        return _cache["channels"]

    log.debug("Cache miss for M3U data, fetching from {}", settings.ersatztv_m3u_url)

    try:
        response = fetch_feed(settings.ersatztv_m3u_url)
        response.raise_for_status()

        channels = _parse_m3u_content(response.text)

        # Update cache
        _cache["channels"] = channels
        _cache["timestamp"] = datetime.now()
        _cache["last_successful_fetch"] = datetime.now()

        log.info("Refreshed M3U cache: {} channels parsed", len(channels))
        return channels

    except Exception as e:
        _cache["retry_at"] = datetime.now() + timedelta(seconds=5)
        log.error("Failed to fetch M3U: {}", e)
        if _cache["last_successful_fetch"] is not None:
            log.warning("Returning stale M3U cached data after fetch failure")
            return _cache["channels"]
        raise Exception("Failed to load channels from ErsatzTV") from e


def _parse_m3u_content(content: str) -> list[EPGChannel]:
    """Parse M3U content and extract channels."""
    channels = []
    seen_ids: set[str] = set()
    lines = content.split("\n")
    i = 0
    channel_index = 0

    while i < len(lines):
        line = lines[i].strip()

        if line.startswith("#EXTINF:"):
            # Extract attributes using regex
            channel_id = _extract_attr(line, "channel-id")
            tvg_chno = _extract_attr(line, "tvg-chno")
            channel_number = _extract_attr(line, "channel-number")
            tvg_id = _extract_attr(line, "tvg-id")
            tvg_name = _extract_attr(line, "tvg-name")
            tvg_logo = _extract_attr(line, "tvg-logo")
            group = _extract_attr(line, "group-title")

            # Fallback name extraction from after last comma
            if not tvg_name:
                match = re.search(r",([^,]+)$", line)
                if match:
                    tvg_name = match.group(1).strip()

            # Get stream URL from next non-empty, non-comment line
            i += 1
            stream_url = None
            while i < len(lines):
                next_line = lines[i].strip()
                if next_line.startswith("#EXTINF:"):
                    # Leave the next metadata record for the outer parser.
                    i -= 1
                    break
                if next_line and not next_line.startswith("#"):
                    stream_url = next_line
                    break
                i += 1

            if stream_url:
                # Determine unique ID: tvg-id > channel-id > index
                unique_id = tvg_id or channel_id or str(channel_index + 1)
                original_id = unique_id
                suffix = channel_index + 1
                while unique_id in seen_ids:
                    unique_id = f"{original_id}_{suffix}"
                    suffix += 1
                seen_ids.add(unique_id)

                # Parse channel number
                channel_num = None
                for num_str in [tvg_chno, channel_number]:
                    if num_str:
                        try:
                            channel_num = int(num_str)
                            break
                        except ValueError:
                            pass

                channel = EPGChannel(
                    id=unique_id,
                    xmltv_id=tvg_id or channel_id or original_id,
                    name=tvg_name or unique_id,
                    stream_url=stream_url,
                    logo_url=tvg_logo,
                    number=channel_num,
                    group=group,
                )
                channels.append(channel)
                channel_index += 1

        i += 1

    return channels


def _extract_attr(line: str, attr_name: str) -> str | None:
    """Extract attribute value from EXTINF line."""
    match = re.search(rf'{attr_name}="([^"]*)"', line)
    return match.group(1) if match else None


def clear_cache() -> None:
    """Clear M3U cache, forcing re-fetch on next request."""
    parse_m3u_playlist.__dict__["reset_failure"]()
    _cache["retry_at"] = None
    _cache["timestamp"] = None
    log.info("M3U cache cleared")
