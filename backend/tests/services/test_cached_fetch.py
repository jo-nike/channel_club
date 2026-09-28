"""Tests for the cached upstream value (stale-while-revalidate, stale-if-error)."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.services import cached_fetch
from app.services.cached_fetch import CachedFetch


class Unavailable(Exception):
    pass


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clock = Clock()
    monkeypatch.setattr(cached_fetch, "monotonic", clock)
    return clock


class Upstream:
    """A fetch that counts calls and fails while `error` is set."""

    def __init__(self) -> None:
        self.calls = 0
        self.value = "v1"
        self.error: Exception | None = None
        self.release = asyncio.Event()
        self.release.set()

    async def __call__(self) -> str:
        self.calls += 1
        await self.release.wait()
        if self.error is not None:
            raise self.error
        return self.value


def make(upstream: Upstream) -> CachedFetch[str]:
    return CachedFetch("thing", upstream, ttl=60, error=Unavailable)


async def test_concurrent_misses_share_one_fetch(clock: Clock) -> None:
    upstream = Upstream()
    upstream.release.clear()
    cache = make(upstream)

    waiters = [asyncio.create_task(cache.get()) for _ in range(10)]
    await asyncio.sleep(0)
    upstream.release.set()

    assert await asyncio.gather(*waiters) == ["v1"] * 10
    assert upstream.calls == 1


async def test_failure_is_remembered_for_the_retry_window(clock: Clock) -> None:
    upstream = Upstream()
    upstream.error = RuntimeError("down")
    cache = make(upstream)

    results = await asyncio.gather(*(cache.get() for _ in range(10)), return_exceptions=True)

    assert all(isinstance(r, Exception) for r in results)
    assert upstream.calls == 1
    with pytest.raises(Unavailable, match="thing failed recently: down"):
        await cache.get()
    assert upstream.calls == 1

    clock.now += cached_fetch.FAILURE_TTL_SECONDS
    upstream.error = None
    assert await cache.get() == "v1"
    assert upstream.calls == 2


async def test_expired_value_is_served_while_one_background_refresh_runs(clock: Clock) -> None:
    upstream = Upstream()
    cache = make(upstream)
    assert await cache.get() == "v1"

    clock.now += 61
    upstream.value = "v2"
    upstream.release.clear()
    assert [await cache.get() for _ in range(5)] == ["v1"] * 5
    await asyncio.sleep(0)
    assert upstream.calls == 2
    upstream.release.set()
    assert cache._task is not None
    await cache._task

    assert await cache.get() == "v2"
    assert upstream.calls == 2


async def test_failed_background_refresh_keeps_the_stale_value(clock: Clock) -> None:
    upstream = Upstream()
    cache = make(upstream)
    assert await cache.get() == "v1"

    clock.now += 61
    upstream.error = RuntimeError("down")
    assert await cache.get() == "v1"
    assert cache._task is not None
    await cache._task
    # Inside the retry window no new refresh starts
    assert await cache.get() == "v1"
    assert cache._task.done()
    assert upstream.calls == 2


async def test_refresh_if_due_starts_one_refresh_and_never_waits(clock: Clock) -> None:
    upstream = Upstream()
    upstream.release.clear()
    cache = make(upstream)

    for _ in range(10):
        cache.refresh_if_due()  # missing: returns at once, with one refresh started
    await asyncio.sleep(0)
    assert upstream.calls == 1
    upstream.release.set()
    assert cache._task is not None
    await cache._task
    assert await cache.get() == "v1"

    cache.refresh_if_due()  # fresh
    assert cache._task.done()
    assert upstream.calls == 1

    clock.now += 61
    upstream.error = RuntimeError("down")
    cache.refresh_if_due()  # expired
    await cache._task
    assert upstream.calls == 2
    cache.refresh_if_due()  # inside the failure memo
    assert cache._task.done()
    assert upstream.calls == 2


async def test_aclose_cancels_a_running_refresh(clock: Clock) -> None:
    upstream = Upstream()
    cache = make(upstream)
    await cache.get()
    clock.now += 61
    upstream.release.clear()
    await cache.get()
    task = cache._task
    assert task is not None
    await asyncio.sleep(0)

    await cached_fetch.aclose_all_caches()

    assert task.cancelled()


async def test_invalidate_and_reset_forget_the_value(clock: Clock) -> None:
    upstream = Upstream()
    cache = make(upstream)
    await cache.get()
    upstream.value = "v2"

    cache.invalidate()
    assert await cache.get() == "v2"

    upstream.value = "v3"
    cached_fetch.reset_all_caches()
    assert await cache.get() == "v3"


def test_app_shutdown_closes_the_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    from app import main

    closed = AsyncMock()
    monkeypatch.setattr(main, "aclose_all_caches", closed)
    monkeypatch.setattr(main, "get_grouped_channels", AsyncMock(return_value=[]))
    with TestClient(main.app):
        pass

    closed.assert_awaited_once()
