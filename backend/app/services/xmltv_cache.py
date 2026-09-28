"""One XMLTV guide cache for both guide sources (Dispatcharr and ErsatzTV).

Each source supplies an async fetch (the feed's bytes) and a parse (bytes to
programmes per channel id); this class owns everything else. An expired guide
is served at once while one background task refreshes it (stale-while-revalidate,
RFC 5861); only an empty guide waits, and concurrent waiters share one refresh.
Failed refreshes back off 30 s, doubling to 5 min, and keep the stale guide.
The parse runs in a worker thread, so a large feed never blocks the event loop.
"""

import asyncio
import contextlib
from bisect import bisect_left, bisect_right
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from itertools import accumulate
from typing import TYPE_CHECKING
from xml.etree.ElementTree import Element

from loguru import logger

from app.models.status import EPGHealthStatus
from app.services.bounded_http import failure_reason

if TYPE_CHECKING:
    from loguru import Logger

# Failed XMLTV refreshes back off from 30s, doubling per consecutive failure, up to 5 min
RETRY_BASE_SECONDS = 30
RETRY_MAX_SECONDS = 300

UNKNOWN_TITLE = "Unknown"


def parse_xmltv_datetime(dt_str: str) -> datetime:
    """Parse XMLTV datetime format (YYYYMMDDHHmmss +ZZZZ).

    A missing offset means +0000, and missing seconds mean :00.

    Args:
        dt_str: DateTime string like "20260103200000 +0000"

    Returns:
        Timezone-aware datetime in the feed's own offset.

    Raises:
        ValueError, IndexError: If the string is malformed.
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


def programme_title(programme: Element) -> str:
    """A programme's title; one the feed leaves out or empty is kept as 'Unknown'."""
    title = programme.find("title")
    if title is None or not title.text:
        return UNKNOWN_TITLE
    return title.text


class Schedule[P](list[P]):
    """One channel's programmes sorted by start, with the latest end up to each one.

    Programmes may overlap, so their ends are not sorted, but the running
    maximum is: bisecting it finds the first programme still on air at a time.
    """

    def __init__(
        self,
        programmes: Iterable[P],
        start: Callable[[P], datetime],
        end: Callable[[P], datetime],
    ) -> None:
        super().__init__(sorted(programmes, key=start))
        self.latest_ends: list[datetime] = list(accumulate(map(end, self), max))


@dataclass(frozen=True)
class GuideIndex[P]:
    """A parsed feed: programmes per channel id, and the XMLTV display names."""

    programmes: dict[str, list[P]]
    # normalised display-name -> channel id, the first channel in the feed winning a shared name
    channel_names: dict[str, str] = field(default_factory=dict)
    # channel id -> its normalised display names
    display_names: dict[str, set[str]] = field(default_factory=dict)


class XmltvCache[P]:
    """One source's XMLTV guide: fetched, parsed, cached, refreshed and reported."""

    def __init__(
        self,
        *,
        name: str,
        fetch: Callable[[], Awaitable[bytes]],
        parse: Callable[[bytes], GuideIndex[P]],
        ttl: timedelta,
        start: Callable[[P], datetime],
        end: Callable[[P], datetime],
        unavailable: Callable[[], Exception],
        log: "Logger" = logger,
    ) -> None:
        self.name = name
        self._fetch = fetch
        self._parse = parse
        self._cache_ttl = ttl
        self._start = start
        self._end = end
        self._unavailable = unavailable
        self._log = log
        self._clear()

    def _clear(self) -> None:
        self._cache: dict[str, list[P]] = {}  # channel_id -> programmes sorted by start
        # normalised XMLTV display-name -> channel_id, replaced together with _cache
        self._channel_names: dict[str, str] = {}
        # channel_id -> its normalised XMLTV display names, replaced together with _cache
        self._channel_display_names: dict[str, set[str]] = {}
        self._cache_expires: datetime | None = None
        # A single in-flight lock prevents thundering herd on expiry
        self._refresh_lock = asyncio.Lock()
        # The background refresh behind stale reads; a strong reference, since the
        # loop holds running tasks only weakly
        self._refresh_task: asyncio.Task[None] | None = None
        self._retry_at: datetime | None = None
        self._consecutive_failures = 0
        # Refresh health for admin status; _last_error is a short reason, never the URL
        self._last_attempt_at: datetime | None = None
        self._last_success_at: datetime | None = None
        self._last_error: str | None = None

    def _is_cache_valid(self) -> bool:
        """Check if cache is still valid."""
        if self._cache_expires is None:
            self._log.debug("Cache miss: no expiry set")
            return False
        is_valid = datetime.now(UTC) < self._cache_expires
        if is_valid:
            age = (self._cache_expires - datetime.now(UTC)).total_seconds()
            self._log.debug("Cache hit for {} (expires in {}s)", self.name, int(age))
        else:
            self._log.debug("Cache miss: expired")
        return is_valid

    @staticmethod
    def _delay(failures: int) -> timedelta:
        exponent = min(max(failures - 1, 0), 4)
        return timedelta(seconds=min(RETRY_BASE_SECONDS * 2**exponent, RETRY_MAX_SECONDS))

    def _retry_delay(self) -> timedelta:
        """Wait before the next refresh after the current run of failures.

        30s after the first failure, doubling each time, capped at 5 minutes.
        """
        return self._delay(self._consecutive_failures)

    def _index(self, body: bytes) -> GuideIndex[P]:
        """Parse the feed and index each channel's programmes for bisecting (worker thread)."""
        parsed = self._parse(body)
        return GuideIndex(
            {
                channel_id: Schedule(programmes, self._start, self._end)
                for channel_id, programmes in parsed.programmes.items()
            },
            parsed.channel_names,
            parsed.display_names,
        )

    async def refresh_cache(self) -> bool:
        """Fetch and parse the feed into the cache.

        Any exception is a failed refresh (a short reason goes to the health
        report); CancelledError passes through.

        Returns:
            True if cache was successfully refreshed, False otherwise.
        """
        self._last_attempt_at = datetime.now(UTC)
        try:
            body = await self._fetch()
            # Parse in a thread pool - ElementTree over the whole XMLTV
            # feed is CPU-bound and would otherwise block the event loop
            index = await asyncio.to_thread(self._index, body)
        except Exception as e:
            self._last_error = failure_reason(e)
            if self._last_error == "refresh failed":
                self._log.exception("{} refresh failed", self.name)
                return False
            stale = "serving stale data" if self._cache else "no cached data"
            # The first failure of an outage is an error; the retries repeat it quietly
            level = "ERROR" if self._consecutive_failures == 0 else "DEBUG"
            self._log.log(
                level,
                "Failed to refresh {} ({}): {}; {}, next retry in {}s",
                self.name,
                self._last_error,
                str(e) or type(e).__name__,
                stale,
                int(self._delay(self._consecutive_failures + 1).total_seconds()),
            )
            return False

        # Swap the maps with no await between, so no lookup sees a mix
        self._cache = index.programmes
        self._channel_names = index.channel_names
        self._channel_display_names = index.display_names
        self._cache_expires = datetime.now(UTC) + self._cache_ttl
        self._last_success_at = datetime.now(UTC)
        self._last_error = None

        total_programmes = sum(len(progs) for progs in self._cache.values())
        self._log.info(
            "Refreshed {}: {} channels, {} programmes",
            self.name,
            len(self._cache),
            total_programmes,
        )
        return True

    async def _refresh_if_due(self) -> None:
        """Run one refresh unless the cache is fresh or the failure backoff says wait.

        Serialised behind a lock, so concurrent callers share one XMLTV download
        and parse. The outcome updates the backoff whoever the caller is.
        """
        async with self._refresh_lock:
            # Re-check after acquiring the lock (another caller may have refreshed)
            if self._is_cache_valid():
                return
            if self._retry_at is not None and datetime.now(UTC) < self._retry_at:
                return
            if await self.refresh_cache():
                if self._consecutive_failures:
                    self._log.info(
                        "{} recovered after {} failed refreshes",
                        self.name,
                        self._consecutive_failures,
                    )
                self._consecutive_failures = 0
                self._retry_at = None
            else:
                self._consecutive_failures += 1
                self._retry_at = datetime.now(UTC) + self._retry_delay()

    def _schedule_refresh(self) -> None:
        """Start one background refresh unless one is running or the backoff says wait."""
        if self._refresh_task is not None and not self._refresh_task.done():
            return
        if self._retry_at is not None and datetime.now(UTC) < self._retry_at:
            return
        self._refresh_task = asyncio.create_task(self._refresh_if_due())

    async def _ensure_cache(self) -> None:
        """Make guide data available, blocking on a refresh only when there is none.

        An expired cache is served at once while one background task refreshes
        it (stale-while-revalidate); a failed refresh keeps serving it.

        Raises:
            The source's unavailable error: If cache is empty and refresh fails.
        """
        if self._is_cache_valid():
            return
        if self._cache:
            self._schedule_refresh()
            return

        await self._refresh_if_due()
        if not self._cache and not self._is_cache_valid():
            raise self._unavailable()

    def get_health(self) -> EPGHealthStatus:
        """Report the guide data cache and the outcome of recent refreshes.

        Reads local state only; it never contacts the upstream.
        """
        now = datetime.now(UTC)
        has_data = bool(self._cache)
        expired = self._cache_expires is None or now >= self._cache_expires
        return EPGHealthStatus(
            name=self.name,
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
        """Report guide health at once, starting a background refresh if one is due.

        Never waits on the download, so a status poll is not held up by the
        upstream; the refresh shares the single in-flight task and the backoff.
        """
        if not self._is_cache_valid():
            self._schedule_refresh()
        return self.get_health()

    async def ensure_fresh(self) -> EPGHealthStatus:
        """Refresh the cache now if it is due, then report its health (boot warm-up)."""
        await self._refresh_if_due()
        return self.get_health()

    async def aclose(self) -> None:
        """Cancel and await a running background refresh (shutdown)."""
        task, self._refresh_task = self._refresh_task, None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    def reset(self) -> None:
        """Forget the guide, the backoff and the refresh task (tests: new event loop)."""
        self._clear()

    async def programmes(self, channel_id: str) -> list[P]:
        """A channel's programmes in start order, empty for an unknown channel.

        Raises:
            The source's unavailable error: If cache is empty and refresh fails.
        """
        await self._ensure_cache()
        return self._cache.get(channel_id, [])

    def _schedule(self, programmes: list[P]) -> Schedule[P]:
        if isinstance(programmes, Schedule):
            return programmes
        return Schedule(programmes, self._start, self._end)

    def now_and_next(self, programmes: list[P], now: datetime) -> tuple[P | None, P | None]:
        """The on-air programme and the first one starting once it ends.

        With overlapping programmes, the earliest-starting one on air wins.
        With nothing on air, next is the first programme starting from now.
        """
        schedule = self._schedule(programmes)
        started = bisect_right(schedule, now, key=self._start)
        on_air = bisect_right(schedule.latest_ends, now)
        current = schedule[on_air] if on_air < started else None
        after = self._end(current) if current is not None else now
        following = bisect_left(schedule, after, key=self._start)
        next_up = schedule[following] if following < len(schedule) else None
        return current, next_up

    def in_window(self, programmes: list[P], start: datetime, end: datetime) -> list[P]:
        """The programmes on air at some point in [start, end), in start order."""
        schedule = self._schedule(programmes)
        first = bisect_right(schedule.latest_ends, start)
        stop = bisect_left(schedule, end, key=self._start)
        return [p for p in schedule[first:stop] if self._end(p) > start]

    def starting_between(self, programmes: list[P], start: datetime, end: datetime) -> list[P]:
        """The programmes starting in [start, end), in start order."""
        schedule = self._schedule(programmes)
        first = bisect_left(schedule, start, key=self._start)
        stop = bisect_left(schedule, end, key=self._start)
        return schedule[first:stop]
