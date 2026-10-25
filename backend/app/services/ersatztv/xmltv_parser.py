"""ErsatzTV XMLTV EPG parser

Parses XMLTV EPG data to extract programme schedules, cached for 5 minutes in
the shared XMLTV cache (app.services.xmltv_cache) with UTC programme times.

Story: 7.3 - XMLTV Parser Service
"""

import contextlib
from datetime import UTC, datetime, timedelta

from defusedxml import ElementTree
from loguru import logger

from app.config import settings
from app.models.ersatztv import Programme
from app.models.status import EPGHealthStatus
from app.services.bounded_http import FEED_BYTES, read_bounded
from app.services.cached_fetch import register_closable
from app.services.ersatztv.refresh import FeedUnavailableError
from app.services.http_clients import ersatztv_client
from app.services.xmltv_cache import (
    GuideIndex,
    XmltvCache,
    parse_xmltv_datetime,
    programme_title,
)

# Module-level logger with service context
log = logger.bind(service="ersatztv")

CACHE_TTL = timedelta(minutes=5)
# The per-read timeout fetch_feed used; read_bounded adds the body deadline
FETCH_TIMEOUT_SECONDS = 2


def _parse_xmltv_datetime(dt_str: str) -> datetime:
    """Parse an XMLTV datetime (the shared parser) and convert it to UTC."""
    return parse_xmltv_datetime(dt_str).astimezone(UTC)


async def _fetch_xmltv() -> bytes:
    """Download ErsatzTV's XMLTV feed within the feed byte budget."""
    log.debug("Fetching XMLTV data from {}", settings.ersatztv_xmltv_url)
    async with ersatztv_client().stream(
        "GET", settings.ersatztv_xmltv_url, timeout=FETCH_TIMEOUT_SECONDS
    ) as response:
        response.raise_for_status()
        return await read_bounded(response, FEED_BYTES)


def _parse_xmltv_content(content: str | bytes) -> list[Programme]:
    """Parse XMLTV content and extract programmes."""
    root = ElementTree.fromstring(content)
    programmes = []

    for elem in root.findall("programme"):
        try:
            channel_id = elem.get("channel")
            start_str = elem.get("start")
            stop_str = elem.get("stop")

            if not channel_id or not start_str or not stop_str:
                continue

            start = _parse_xmltv_datetime(start_str)
            stop = _parse_xmltv_datetime(stop_str)

            title = programme_title(elem)

            desc_elem = elem.find("desc")
            description = desc_elem.text if desc_elem is not None else None

            category_elems = elem.findall("category")
            categories = [c.text for c in category_elems if c.text] or None

            # Parse episode number (xmltv_ns format: "season-1.episode-1.part-1", 0-indexed)
            season = None
            episode = None
            for ep_elem in elem.findall("episode-num"):
                system = ep_elem.get("system", "")
                text = ep_elem.text if ep_elem.text else ""
                if system == "xmltv_ns" and text:
                    parts = text.split(".")
                    if len(parts) >= 1 and parts[0].strip():
                        with contextlib.suppress(ValueError):
                            season = int(parts[0].strip()) + 1
                    if len(parts) >= 2 and parts[1].strip():
                        with contextlib.suppress(ValueError):
                            episode = int(parts[1].strip()) + 1

            # Parse release year
            date_elem = elem.find("date")
            year = date_elem.text.strip()[:4] if date_elem is not None and date_elem.text else None

            programme_id = f"{channel_id}_{int(start.timestamp())}"

            programme = Programme(
                id=programme_id,
                channel_id=channel_id,
                title=title,
                description=description,
                start=start,
                stop=stop,
                category=categories,
                season=season,
                episode=episode,
                year=year,
            )
            programmes.append(programme)

        except (ValueError, IndexError, AttributeError) as e:
            log.warning("Skipping programme due to parse error: {}", e)
            continue

    return programmes


def _index_xmltv(body: bytes) -> GuideIndex[Programme]:
    """Group the feed's programmes by channel id (the cache sorts each channel)."""
    by_channel: dict[str, list[Programme]] = {}
    for programme in _parse_xmltv_content(body):
        by_channel.setdefault(programme.channel_id, []).append(programme)
    return GuideIndex(by_channel)


guide: XmltvCache[Programme] = XmltvCache(
    name="ErsatzTV guide (XMLTV)",
    fetch=_fetch_xmltv,
    parse=_index_xmltv,
    ttl=CACHE_TTL,
    start=lambda programme: programme.start,
    end=lambda programme: programme.stop,
    unavailable=lambda: FeedUnavailableError(
        f"Failed to load EPG from ErsatzTV ({guide.get_health().error})"
    ),
    configured=lambda: bool(settings.ersatztv_base_url),
    log=log,
)
# Shut down and reset (tests) with the upstream caches
register_closable(guide)


def get_health() -> EPGHealthStatus:
    """Report the ErsatzTV guide cache and the outcome of recent refreshes.

    Reads local state only; it never contacts ErsatzTV. ``online`` means
    programmes are cached, ``stale`` that they are past their TTL.
    """
    return guide.get_health()
