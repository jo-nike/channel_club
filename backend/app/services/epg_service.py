"""EPG service for fetching and caching XMLTV data from Dispatcharr."""

import asyncio
import contextlib
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta, timezone

import httpx
from defusedxml import DefusedXmlException, ElementTree
from loguru import logger

from app.config import settings
from app.models.channel import Channel
from app.models.epg import EPGProgrammesResponse, EPGResponse, Program
from app.models.status import EPGHealthStatus
from app.services.bounded_http import FEED_BYTES, read_bounded
from app.services.tls import SSL_CONTEXT

# Module-level logger with service context
log = logger.bind(service="epg")

# A schedule window keeps programmes that ended this recently, so the one just finished still shows
PROGRAMMES_LOOKBACK = timedelta(minutes=30)

# Failed XMLTV refreshes back off from 30s, doubling per consecutive failure, up to 5 min
RETRY_BASE_SECONDS = 30
RETRY_MAX_SECONDS = 300

EPG_HEALTH_NAME = "Guide data (XMLTV)"


def normalise_channel_name(name: str) -> str:
    """Normalise a channel name for matching: casefolded, whitespace collapsed."""
    return " ".join(name.split()).casefold()


class EPGServiceError(Exception):
    """Raised when EPG service encounters an error."""

    pass


class _FeedTooLargeError(Exception):
    """The XMLTV body exceeded its byte budget."""


class EPGService:
    """Service for fetching and caching EPG data from Dispatcharr XMLTV endpoint."""

    def __init__(self, dispatcharr_url: str):
        self.dispatcharr_url = dispatcharr_url
        self._cache: dict[str, list[Program]] = {}  # channel_id -> list of programs
        # normalised XMLTV display-name -> channel_id, replaced together with _cache
        self._channel_names: dict[str, str] = {}
        self._cache_expires: datetime | None = None
        self._cache_ttl = timedelta(hours=24)
        # A single in-flight lock prevents thundering herd on expiry
        self._refresh_lock = asyncio.Lock()
        self._retry_at: datetime | None = None
        self._consecutive_failures = 0
        # Refresh health for admin status; _last_error is a short reason, never the URL
        self._last_attempt_at: datetime | None = None
        self._last_success_at: datetime | None = None
        self._last_error: str | None = None

    def _is_cache_valid(self) -> bool:
        """Check if cache is still valid."""
        if self._cache_expires is None:
            log.debug("Cache miss: no expiry set")
            return False
        is_valid = datetime.now(UTC) < self._cache_expires
        if is_valid:
            age = (self._cache_expires - datetime.now(UTC)).total_seconds()
            log.debug("Cache hit for EPG data (expires in {}s)", int(age))
        else:
            log.debug("Cache miss: expired")
        return is_valid

    def _retry_delay(self) -> timedelta:
        """Wait before the next refresh after the current run of failures.

        30s after the first failure, doubling each time, capped at 5 minutes.
        """
        exponent = min(max(self._consecutive_failures - 1, 0), 4)
        return timedelta(seconds=min(RETRY_BASE_SECONDS * 2**exponent, RETRY_MAX_SECONDS))

    def _parse_xmltv_datetime(self, dt_str: str) -> datetime:
        """Parse XMLTV datetime format (YYYYMMDDHHmmss +ZZZZ).

        Args:
            dt_str: DateTime string like "20260103200000 +0000"

        Returns:
            Timezone-aware datetime object.
        """
        # Split datetime and timezone parts
        parts = dt_str.strip().split()
        dt_part = parts[0]
        tz_part = parts[1] if len(parts) > 1 else "+0000"

        # Parse the datetime part
        year = int(dt_part[0:4])
        month = int(dt_part[4:6])
        day = int(dt_part[6:8])
        hour = int(dt_part[8:10])
        minute = int(dt_part[10:12])
        second = int(dt_part[12:14]) if len(dt_part) >= 14 else 0

        # Parse timezone offset
        tz_sign = 1 if tz_part[0] == "+" else -1
        tz_hours = int(tz_part[1:3])
        tz_minutes = int(tz_part[3:5])
        tz_offset = timedelta(hours=tz_sign * tz_hours, minutes=tz_sign * tz_minutes)

        return datetime(year, month, day, hour, minute, second, tzinfo=timezone(tz_offset))

    def _parse_xmltv(
        self, xml_content: str | bytes
    ) -> tuple[dict[str, list[Program]], dict[str, str]]:
        """Parse XMLTV XML content into channel->programs and name->channel mappings.

        Args:
            xml_content: Raw XML from Dispatcharr's /output/epg. Bytes are decoded
                by the parser, following the XML declaration's encoding.

        Returns:
            Tuple of (dict mapping channel_id to list of Program objects,
            dict mapping normalised display-name to channel_id). When two
            channels share a display name, the first one in the feed wins.
        """
        programs_by_channel: dict[str, list[Program]] = {}
        channel_names: dict[str, str] = {}

        try:
            root = ElementTree.fromstring(xml_content)

            for channel in root.findall("channel"):
                xmltv_id = channel.get("id")
                if not xmltv_id:
                    continue
                for display_name in channel.findall("display-name"):
                    if display_name.text and display_name.text.strip():
                        channel_names.setdefault(
                            normalise_channel_name(display_name.text), xmltv_id
                        )

            for programme in root.findall("programme"):
                channel_id = programme.get("channel")
                start_str = programme.get("start")
                stop_str = programme.get("stop")

                if not channel_id or not start_str or not stop_str:
                    continue

                title_elem = programme.find("title")
                title = title_elem.text if title_elem is not None else "Unknown"

                desc_elem = programme.find("desc")
                description = desc_elem.text if desc_elem is not None else None

                try:
                    program = Program(
                        title=title,
                        start_time=self._parse_xmltv_datetime(start_str),
                        end_time=self._parse_xmltv_datetime(stop_str),
                        description=description,
                    )

                    if channel_id not in programs_by_channel:
                        programs_by_channel[channel_id] = []
                    programs_by_channel[channel_id].append(program)
                except (ValueError, IndexError) as e:
                    log.warning("Failed to parse programme: {}", e)
                    continue

            # Sort programs by start time for each channel
            for channel_id in programs_by_channel:
                programs_by_channel[channel_id].sort(key=lambda p: p.start_time)

        except (ElementTree.ParseError, DefusedXmlException) as e:
            log.error("Failed to parse XMLTV: {}", e)
            raise EPGServiceError(f"Failed to parse XMLTV data: {e}") from e

        return programs_by_channel, channel_names

    async def refresh_cache(self) -> bool:
        """Fetch XMLTV from Dispatcharr and parse into cache.

        Returns:
            True if cache was successfully refreshed, False otherwise.
        """
        url = f"{self.dispatcharr_url}/output/epg"
        log.debug("Fetching EPG data from {}", url)
        self._last_attempt_at = datetime.now(UTC)
        try:
            async with httpx.AsyncClient(timeout=30.0, verify=SSL_CONTEXT) as client:
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    # A byte budget and a body deadline, so a huge or slow-drip feed
                    # can neither exhaust memory nor hold the refresh lock
                    try:
                        body = await read_bounded(response, FEED_BYTES)
                    except ValueError as e:
                        raise _FeedTooLargeError from e

                # Parse in a thread pool - ElementTree over the whole XMLTV
                # feed is CPU-bound and would otherwise block the event loop
                programs, channel_names = await asyncio.to_thread(self._parse_xmltv, body)
                # Swap both maps with no await between, so no lookup sees a mix
                self._cache = programs
                self._channel_names = channel_names
                self._cache_expires = datetime.now(UTC) + self._cache_ttl
                self._last_success_at = datetime.now(UTC)
                self._last_error = None

                total_programmes = sum(len(progs) for progs in self._cache.values())
                log.info(
                    "Refreshed EPG cache: {} channels, {} programmes",
                    len(self._cache),
                    total_programmes,
                )
                return True

        except httpx.HTTPStatusError as e:
            log.error("XMLTV HTTP error from {}: {} - {}", url, e.response.status_code, e)
            self._last_error = f"HTTP {e.response.status_code}"
            return False
        except httpx.ConnectError as e:
            log.error("Failed to connect to Dispatcharr at {}: {}", url, e)
            self._last_error = "connection failed"
            return False
        except (httpx.TimeoutException, TimeoutError) as e:
            log.error("Timeout fetching XMLTV from {}: {}", url, type(e).__name__)
            self._last_error = "timeout"
            return False
        except _FeedTooLargeError:
            log.error("XMLTV feed from {} exceeds {} bytes", url, FEED_BYTES)
            self._last_error = "feed too large"
            return False
        except httpx.HTTPError as e:
            log.error("Failed to fetch XMLTV from {}: {}", url, e)
            self._last_error = "request failed"
            return False
        except EPGServiceError as e:
            log.error("Failed to parse XMLTV data: {}", e)
            self._last_error = "invalid XMLTV"
            return False
        except Exception:
            # Anything else still counts as a failed refresh, so the stale cache,
            # the backoff and the health report hold; CancelledError passes through
            log.exception("XMLTV refresh failed")
            self._last_error = "refresh failed"
            return False

    async def _ensure_cache(self) -> None:
        """Refresh the cache if stale, falling back to stale data on failure.

        The refresh is serialized behind a lock so that concurrent requests
        hitting an expired cache share one XMLTV download and parse.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        if self._is_cache_valid():
            return

        async with self._refresh_lock:
            # Re-check after acquiring the lock (another request may have refreshed)
            if self._is_cache_valid():
                return

            if self._retry_at is not None and datetime.now(UTC) < self._retry_at:
                if self._cache:
                    return
                raise EPGServiceError("EPG service unavailable; retry later")
            refresh_success = await self.refresh_cache()
            if refresh_success:
                self._consecutive_failures = 0
                self._retry_at = None
            else:
                self._consecutive_failures += 1
                self._retry_at = datetime.now(UTC) + self._retry_delay()

        if not refresh_success:
            # If refresh failed but we have stale cache, use it
            if self._cache:
                log.warning("Using stale EPG cache after refresh failure")
            else:
                raise EPGServiceError("EPG service unavailable")

    def get_health(self) -> EPGHealthStatus:
        """Report the guide data cache and the outcome of recent refreshes.

        Reads local state only; it never contacts Dispatcharr.
        """
        now = datetime.now(UTC)
        has_data = bool(self._cache)
        expired = self._cache_expires is None or now >= self._cache_expires
        return EPGHealthStatus(
            name=EPG_HEALTH_NAME,
            online=has_data,
            last_checked=now,
            error=self._last_error,
            stale=has_data and expired,
            channel_count=len(self._cache),
            programme_count=sum(len(programs) for programs in self._cache.values()),
            last_attempt_at=self._last_attempt_at,
            last_success_at=self._last_success_at,
            next_retry_at=self._retry_at,
        )

    async def check_health(self) -> EPGHealthStatus:
        """Refresh the cache if it is due, then report its health.

        Goes through _ensure_cache, so a status poll shares the single in-flight
        refresh and waits out the failure backoff instead of hitting Dispatcharr.
        """
        # A failed refresh is what get_health reports, so it is not an error here
        with contextlib.suppress(EPGServiceError):
            await self._ensure_cache()
        return self.get_health()

    def _find_current_and_next(
        self, programs: list[Program], now: datetime
    ) -> tuple[Program | None, Program | None]:
        """Find the on-air program and the one following it.

        Args:
            programs: Programs for a single channel, sorted by start time.
            now: Timezone-aware reference time.

        Returns:
            Tuple of (current program, next program), either of which may be None.
        """
        current_program: Program | None = None
        next_program: Program | None = None

        for i, program in enumerate(programs):
            # Convert to UTC for comparison if needed
            start = program.start_time
            end = program.end_time
            if start.tzinfo != UTC:
                start = start.astimezone(UTC)
            if end.tzinfo != UTC:
                end = end.astimezone(UTC)

            if start <= now < end:
                current_program = program
                # Get next program if available
                if i + 1 < len(programs):
                    next_program = programs[i + 1]
                break
            elif start > now and next_program is None:
                # This is the next upcoming program
                next_program = program
                break

        return current_program, next_program

    def _resolve_programs(
        self, channel_id: str, channel_name: str | None
    ) -> tuple[list[Program], str | None]:
        """Find a channel's programmes by guide id, then by name when the id has none.

        Args:
            channel_id: Guide id of the channel.
            channel_name: Optional channel name to match against XMLTV display names.

        Returns:
            Tuple of (programmes, XMLTV id matched by name). The XMLTV id is None
            unless the name fallback was used.
        """
        programs = self._cache.get(channel_id, [])
        if programs or not channel_name:
            return programs, None

        xmltv_id = self._channel_names.get(normalise_channel_name(channel_name))
        if xmltv_id is None:
            return programs, None
        return self._cache.get(xmltv_id, []), xmltv_id

    async def get_now_playing(
        self, channel_id: str, channel_name: str | None = None
    ) -> EPGResponse:
        """Get current and next program for a channel.

        The guide id is tried first. Only when it has no programmes is the
        channel name matched against the XMLTV display names, which covers a
        feed keyed differently from the guide id (another tvg_id_source, or a
        profile's own channel numbering).

        Args:
            channel_id: Guide id of the channel to look up.
            channel_name: Optional channel name to fall back on.

        Returns:
            EPGResponse with current and next program info.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        await self._ensure_cache()

        programs, xmltv_id = self._resolve_programs(channel_id, channel_name)
        if xmltv_id is not None:
            log.debug(
                "Guide id {} missed; matched channel name {!r} to XMLTV id {}",
                channel_id,
                channel_name,
                xmltv_id,
            )

        if not programs:
            return EPGResponse(
                channel_id=channel_id,
                current_program=None,
                next_program=None,
            )

        current_program, next_program = self._find_current_and_next(programs, datetime.now(UTC))

        return EPGResponse(
            channel_id=channel_id,
            current_program=current_program,
            next_program=next_program,
        )

    async def get_programmes(
        self, channel_id: str, hours: int, channel_name: str | None = None
    ) -> EPGProgrammesResponse:
        """Get a channel's schedule from 30 minutes ago to the given number of hours ahead.

        The channel is resolved like get_now_playing: guide id first, then the
        channel name against the XMLTV display names when the id has no
        programmes.

        Args:
            channel_id: Guide id of the channel to look up.
            hours: How far ahead of now the window reaches.
            channel_name: Optional channel name to fall back on.

        Returns:
            EPGProgrammesResponse with the programmes that end after now minus
            30 minutes and start before now plus hours, in start order.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        await self._ensure_cache()

        programs, xmltv_id = self._resolve_programs(channel_id, channel_name)
        if xmltv_id is not None:
            log.debug(
                "Guide id {} missed; matched channel name {!r} to XMLTV id {}",
                channel_id,
                channel_name,
                xmltv_id,
            )

        now = datetime.now(UTC)
        window_start = now - PROGRAMMES_LOOKBACK
        window_end = now + timedelta(hours=hours)
        in_window: list[Program] = []
        # The cache is sorted by start time, so nothing after the window end can match
        for program in programs:
            if program.start_time >= window_end:
                break
            if program.end_time > window_start:
                in_window.append(program)

        return EPGProgrammesResponse(channel_id=channel_id, programmes=in_window)

    async def get_now_playing_bulk(self, channels: Iterable[Channel] = ()) -> dict[str, Program]:
        """Get the on-air program for every channel in the EPG cache.

        The whole XMLTV feed is already cached in memory, so this is a scan over
        local data rather than one upstream call per channel.

        Each of the given catalogue channels is also resolved the way
        get_now_playing resolves it (guide id first, then its name against the
        XMLTV display names), so a feed keyed differently from the guide ids
        still yields an entry under each channel's guide id.

        Args:
            channels: Catalogue channels to key by guide id.

        Returns:
            Mapping of XMLTV channel id, and of each given channel's guide id, to
            its current program. Channels with nothing on air are omitted.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        await self._ensure_cache()

        now = datetime.now(UTC)
        now_playing: dict[str, Program] = {}

        for channel_id, programs in self._cache.items():
            current_program, _ = self._find_current_and_next(programs, now)
            if current_program is not None:
                now_playing[channel_id] = current_program

        for channel in channels:
            if channel.guide_id in now_playing:
                continue
            programs, xmltv_id = self._resolve_programs(channel.guide_id, channel.name)
            if xmltv_id is None:
                continue
            current_program, _ = self._find_current_and_next(programs, now)
            if current_program is not None:
                now_playing[channel.guide_id] = current_program

        log.debug("Bulk now-playing: {} of {} channels on air", len(now_playing), len(self._cache))
        return now_playing


# Global singleton instance
_epg_service: EPGService | None = None


def get_epg_service() -> EPGService:
    """Get or create the EPG service singleton.

    Returns:
        EPGService instance configured with Dispatcharr URL.
    """
    global _epg_service
    if _epg_service is None:
        _epg_service = EPGService(settings.dispatcharr_url)
    return _epg_service
