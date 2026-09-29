"""Cache one upstream value so an outage serves the last good copy (RFC 5861).

Once filled, readers never wait on the upstream: an expired value is served at
once while one background task refreshes it (stale-while-revalidate), and a
failed refresh keeps serving it (stale-if-error). Only an empty cache blocks,
and concurrent misses share one fetch. A failure is remembered for
failure_ttl seconds, so during an outage callers get the stale value or a fast
error instead of each repeating the fetch.
"""

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import suppress
from time import monotonic
from typing import Protocol, cast

from loguru import logger

log = logger.bind(service="cached_fetch")

FAILURE_TTL_SECONDS = 20.0


class _Closable(Protocol):
    async def aclose(self) -> None: ...

    def reset(self) -> None: ...


_instances: list[_Closable] = []


class CachedFetch[T]:
    """One cached upstream value; one instance per upstream."""

    def __init__(
        self,
        name: str,
        fetch: Callable[[], Awaitable[T]],
        ttl: float,
        error: Callable[[str], Exception],
        failure_ttl: float = FAILURE_TTL_SECONDS,
    ) -> None:
        self.name = name
        self._fetch = fetch
        self._ttl = ttl
        self._error = error
        self._failure_ttl = failure_ttl
        self._value: T | None = None
        self._has_value = False
        self._fresh_until = 0.0
        self._retry_after = 0.0
        self._last_error: str | None = None
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        # Bumped by invalidate(): a fetch that started before it keeps nothing
        self._generation = 0
        _instances.append(self)

    async def get(self) -> T:
        """The cached value, fetching it only when the cache is empty.

        Raises:
            The fetch's own exception for the caller that ran a failed fetch,
            or error(...) while a recent failure is remembered.
        """
        if self._has_value:
            if monotonic() >= self._fresh_until:
                self._schedule_refresh()
            return cast(T, self._value)
        # Checked before the lock too, so fast failures don't queue behind a fetch
        self._raise_if_recently_failed()
        async with self._lock:
            if self._has_value:
                return cast(T, self._value)
            self._raise_if_recently_failed()
            return await self._refresh()

    def peek(self) -> T | None:
        """The cached value as it is, expired or not, or None if it never loaded.

        Never fetches, never schedules a refresh and never waits.
        """
        return self._value if self._has_value else None

    def refresh_if_due(self) -> None:
        """Start one background refresh if the value is expired or missing; never wait on it.

        Nothing starts while a refresh runs or a recent failure is remembered.
        """
        if not self._has_value or monotonic() >= self._fresh_until:
            self._schedule_refresh()

    def invalidate(self) -> None:
        """Drop the value and any remembered failure; the next get() fetches.

        A fetch already running finishes, but neither its value nor its failure
        is kept: it used the settings the invalidation replaced.
        """
        self._generation += 1
        self._value = None
        self._has_value = False
        self._fresh_until = 0.0
        self._retry_after = 0.0
        self._last_error = None

    async def aclose(self) -> None:
        """Cancel and await a running background refresh (shutdown)."""
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    def reset(self) -> None:
        """Forget everything, including the lock and task (tests: new event loop)."""
        self.invalidate()
        self._lock = asyncio.Lock()
        self._task = None

    def _raise_if_recently_failed(self) -> None:
        if monotonic() < self._retry_after:
            raise self._error(f"{self.name} failed recently: {self._last_error}")

    async def _refresh(self) -> T:
        # Callers hold self._lock
        generation = self._generation
        try:
            value = await self._fetch()
        except Exception as e:
            if generation == self._generation:
                self._retry_after = monotonic() + self._failure_ttl
                self._last_error = str(e)
            raise
        if generation != self._generation:
            # Invalidated while fetching: this caller gets it, the cache doesn't
            return value
        self._value = value
        self._has_value = True
        self._fresh_until = monotonic() + self._ttl
        self._retry_after = 0.0
        self._last_error = None
        return value

    def _schedule_refresh(self) -> None:
        if self._task is not None and not self._task.done():
            return
        if self._lock.locked() or monotonic() < self._retry_after:
            return
        # Keep a strong reference: the loop holds running tasks only weakly
        self._task = asyncio.create_task(self._background_refresh())

    async def _background_refresh(self) -> None:
        async with self._lock:
            if self._has_value and monotonic() < self._fresh_until:
                return
            try:
                await self._refresh()
            except Exception as e:
                log.warning("Serving stale {} after a failed refresh: {}", self.name, str(e))


def register_closable(holder: _Closable) -> None:
    """Close and reset another holder of a background refresh with the caches."""
    _instances.append(holder)


async def aclose_all_caches() -> None:
    """Stop every instance's background refresh (the lifespan teardown)."""
    await asyncio.gather(*(cache.aclose() for cache in _instances))


def reset_all_caches() -> None:
    """Empty every instance (tests)."""
    for cache in _instances:
        cache.reset()
