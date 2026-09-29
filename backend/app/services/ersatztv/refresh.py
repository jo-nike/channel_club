"""Serve synchronous feed caches without making readers wait on a refresh.

A fresh cache is read without the lock. While one thread refreshes a feed, or
while a failed refresh backs off, every other reader gets the stale data at
once; only a cold cache waits, so concurrent cold callers share one attempt.
Failed refreshes back off 30 s, doubling to 5 min (XmltvCache._retry_delay).
"""

import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from functools import partial, update_wrapper
from threading import Lock
from time import monotonic

from loguru import logger

from app.services.bounded_http import failure_reason

log = logger.bind(service="ersatztv")

RETRY_BASE_SECONDS = 30
RETRY_MAX_SECONDS = 300

# Feed lookups run on their own small pool, so a slow ErsatzTV refresh parks
# these threads and never the default executor that other to_thread work uses.
FEED_WORKERS = 4
_executor: ThreadPoolExecutor | None = None


async def run_feed_lookup[R](function: Callable[..., R], *args: object, **kwargs: object) -> R:
    """Run a synchronous feed lookup on the dedicated feeds executor."""
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=FEED_WORKERS, thread_name_prefix="feeds")
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_executor, partial(function, *args, **kwargs))


def shutdown_feed_executor() -> None:
    """Drop queued lookups without waiting on running ones; the next lookup starts a new pool."""
    global _executor
    executor, _executor = _executor, None
    if executor is not None:
        executor.shutdown(wait=False, cancel_futures=True)


async def stop_feed_executor() -> None:
    """The lifespan teardown entry for the feeds executor."""
    shutdown_feed_executor()


class FeedUnavailableError(Exception):
    """A feed has no cached data and cannot be fetched now."""


class SerializedRefresh[T]:
    """Wraps a feed's fetch-and-store function; the module owns the cache dict.

    ``cache[key]`` holds the data, ``cache["last_successful_fetch"]`` says
    whether any exists, and ``is_expired()`` says whether it is due a refresh.
    """

    def __init__(
        self,
        function: Callable[[], list[T]],
        *,
        name: str,
        unavailable: str,
        cache: dict,
        key: str,
        is_expired: Callable[[], bool],
    ) -> None:
        update_wrapper(self, function)
        self._function = function
        self.name = name
        self._unavailable_message = unavailable
        self._cache = cache
        self._key = key
        self._is_expired = is_expired
        self._lock = Lock()
        self.consecutive_failures = 0
        self.retry_at = 0.0
        self.next_retry_at: datetime | None = None
        self.last_error: str | None = None
        self.last_attempt_at: datetime | None = None
        self.last_success_at: datetime | None = None
        self._failure: BaseException | None = None

    def _has_data(self) -> bool:
        return self._cache["last_successful_fetch"] is not None

    def _backing_off(self) -> bool:
        return self._failure is not None and monotonic() < self.retry_at

    def _unavailable(self) -> FeedUnavailableError:
        error = FeedUnavailableError(f"{self._unavailable_message} ({self.last_error})")
        error.__cause__ = self._failure
        return error

    def __call__(self) -> list[T]:
        # Reading the cache without the lock is safe: the list is replaced whole
        if self._has_data():
            if not self._is_expired() or self._backing_off():
                return self._cache[self._key]
            if not self._lock.acquire(blocking=False):
                return self._cache[self._key]  # a refresh is in flight
        else:
            # Checked before the lock too, so fast failures don't queue behind a fetch
            if self._backing_off():
                raise self._unavailable()
            self._lock.acquire()
        try:
            return self._refresh()
        finally:
            self._lock.release()

    def _refresh(self) -> list[T]:
        # Callers hold self._lock; another thread may have refreshed or failed meanwhile
        if self._has_data() and (not self._is_expired() or self._backing_off()):
            return self._cache[self._key]
        if self._backing_off():
            raise self._unavailable()
        self.last_attempt_at = datetime.now(UTC)
        try:
            result = self._function()
        except Exception as exc:
            self._record_failure(exc)
            if self._has_data():
                return self._cache[self._key]
            raise self._unavailable() from exc
        if self.consecutive_failures:
            log.info("{} recovered after {} failed refreshes", self.name, self.consecutive_failures)
        self.consecutive_failures = 0
        self._failure = None
        self.retry_at = 0.0
        self.next_retry_at = None
        self.last_error = None
        self.last_success_at = datetime.now(UTC)
        return result

    def _record_failure(self, exc: Exception) -> None:
        self.consecutive_failures += 1
        exponent = min(self.consecutive_failures - 1, 4)
        delay = min(RETRY_BASE_SECONDS * 2**exponent, RETRY_MAX_SECONDS)
        self._failure = exc
        self.retry_at = monotonic() + delay
        self.next_retry_at = datetime.now(UTC) + timedelta(seconds=delay)
        self.last_error = failure_reason(exc)
        stale = "serving stale data" if self._has_data() else "no cached data"
        # The first failure of an outage is an error; the retries repeat it quietly
        level = "ERROR" if self.consecutive_failures == 1 else "DEBUG"
        log.log(
            level,
            "Failed to refresh {} ({}): {}; {}, next retry in {}s",
            self.name,
            self.last_error,
            str(exc) or type(exc).__name__,
            stale,
            delay,
        )

    def reset_failure(self) -> None:
        """Forget the failure and its backoff; the next read fetches if due."""
        with self._lock:
            self.consecutive_failures = 0
            self.retry_at = 0.0
            self.next_retry_at = None
            self.last_error = None
            self._failure = None

    def reset(self) -> None:
        """Forget the data, the failure and the refresh history (tests)."""
        self.reset_failure()
        self._cache[self._key] = []
        self._cache["timestamp"] = None
        self._cache["last_successful_fetch"] = None
        self.last_attempt_at = None
        self.last_success_at = None


def serialized_refresh[T](
    *, name: str, unavailable: str, cache: dict, key: str, is_expired: Callable[[], bool]
) -> Callable[[Callable[[], list[T]]], SerializedRefresh[T]]:
    """Decorate a feed's fetch-and-store function with the shared read policy."""

    def decorate(function: Callable[[], list[T]]) -> SerializedRefresh[T]:
        return SerializedRefresh(
            function,
            name=name,
            unavailable=unavailable,
            cache=cache,
            key=key,
            is_expired=is_expired,
        )

    return decorate
