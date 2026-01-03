"""ErsatzTV M3U playlist parser

Parses M3U playlists with extended metadata attributes.
Implements 1-hour TTL caching with graceful fallback.

Story: 7.2 - M3U Parser Service
"""

import logging
import re
from datetime import datetime

import httpx

from app.config import settings
from app.models.ersatztv import EPGChannel

logger = logging.getLogger(__name__)


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
    if not _is_cache_expired():
        logger.debug("Returning cached M3U data")
        return _cache["channels"]

    try:
        logger.info("Fetching M3U playlist from ErsatzTV")
        response = httpx.get(settings.ersatztv_m3u_url, timeout=30)
        response.raise_for_status()

        channels = _parse_m3u_content(response.text)

        # Update cache
        _cache["channels"] = channels
        _cache["timestamp"] = datetime.now()
        _cache["last_successful_fetch"] = datetime.now()

        logger.info(f"Parsed {len(channels)} channels from M3U")
        return channels

    except Exception as e:
        logger.warning(f"Failed to fetch M3U: {e}")
        if _cache["last_successful_fetch"] is not None:
            logger.info("Returning stale cached data")
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
                if next_line and not next_line.startswith("#"):
                    stream_url = next_line
                    break
                i += 1

            if stream_url:
                # Determine unique ID: tvg-id > channel-id > index
                unique_id = tvg_id or channel_id or str(channel_index + 1)
                if unique_id in seen_ids:
                    unique_id = f"{unique_id}_{channel_index + 1}"
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
    _cache["timestamp"] = None
    logger.info("M3U cache cleared")
