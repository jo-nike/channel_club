"""MEDIA-02: a stalled synchronous feed must not stall unrelated ASGI work."""

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import httpx
import pytest

from app.main import app
from app.models.ersatztv import EPGChannel, Programme
from app.services.auth import create_access_token
from app.services.ersatztv import epg_service as ersatztv_epg
from app.services.ersatztv import m3u_parser
from app.services.ersatztv.m3u_parser import parse_m3u_playlist
from app.services.ersatztv.refresh import (
    FeedUnavailableError,
    run_feed_lookup,
    stop_feed_executor,
)
from app.services.ersatztv.xmltv_parser import guide


@pytest.mark.asyncio
async def test_public_logo_lookup_does_not_block_health():
    entered, release = threading.Event(), threading.Event()

    def lookup(_):
        entered.set()
        assert release.wait(2)
        return None

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as c:
        with patch("app.routers.ersatztv.get_channel_by_id", side_effect=lookup):
            logo = asyncio.create_task(c.get("/api/ersatztv/logos/missing"))
            try:
                assert await asyncio.to_thread(entered.wait, 1)
                response = await asyncio.wait_for(c.get("/api/health"), 0.5)
                assert response.status_code == 200
                assert not logo.done()
            finally:
                release.set()
                assert (await logo).status_code == 404


class _CountingLock:
    """The refresh lock, counting the callers that have reached it."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._count_lock = threading.Lock()
        self.arrivals = 0
        self.all_arrived = threading.Event()

    def acquire(self, blocking: bool = True) -> bool:
        with self._count_lock:
            self.arrivals += 1
            if self.arrivals == CALLERS:
                self.all_arrived.set()
        return self._lock.acquire(blocking)

    def release(self) -> None:
        self._lock.release()

    def __enter__(self) -> bool:
        return self.acquire()

    def __exit__(self, *exc: object) -> None:
        self.release()


CALLERS = 20


def test_parallel_cold_feed_failure_is_shared(monkeypatch):
    """Callers queued on the lock behind a failing cold fetch share its failure."""
    attempts = 0
    lock = _CountingLock()
    monkeypatch.setattr(parse_m3u_playlist, "_lock", lock)

    def fetch(_url):
        nonlocal attempts
        attempts += 1
        # Fail only once every other caller is past the pre-lock backoff check
        assert lock.all_arrived.wait(2)
        time.sleep(0.05)  # and parked in acquire()
        raise ValueError("controlled upstream unavailable")

    with (
        patch("app.services.ersatztv.m3u_parser.fetch_feed", side_effect=fetch),
        ThreadPoolExecutor(max_workers=CALLERS) as pool,
    ):
        futures = [pool.submit(parse_m3u_playlist) for _ in range(CALLERS)]
        errors = [future.exception(5) for future in futures]
    assert all(isinstance(error, FeedUnavailableError) for error in errors)
    assert attempts == 1


@pytest.mark.asyncio
async def test_parked_feed_lookups_leave_the_default_executor_free():
    """N-01: 40 lookups behind a hung cold refresh park only the feeds executor."""
    entered, release = threading.Event(), threading.Event()

    def hang(_url):
        entered.set()
        assert release.wait(5)
        raise ValueError("controlled upstream unavailable")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as c:
        with patch("app.services.ersatztv.m3u_parser.fetch_feed", side_effect=hang):
            logos = [asyncio.create_task(c.get(f"/api/ersatztv/logos/ch{i}")) for i in range(40)]
            try:
                assert await asyncio.to_thread(entered.wait, 1)
                await asyncio.sleep(0.05)  # let every request queue its lookup
                loop = asyncio.get_running_loop()
                started = loop.time()
                await asyncio.wait_for(asyncio.to_thread(lambda: None), 0.5)
                assert loop.time() - started < 0.1
                assert not any(logo.done() for logo in logos)
            finally:
                release.set()
            responses = await asyncio.gather(*logos)
    assert {response.status_code for response in responses} == {503}


@pytest.mark.asyncio
async def test_feed_executor_teardown_drops_queued_lookups():
    release = threading.Event()
    running = [asyncio.ensure_future(run_feed_lookup(release.wait, 5)) for _ in range(4)]
    queued = [asyncio.ensure_future(run_feed_lookup(lambda: None)) for _ in range(4)]
    await asyncio.sleep(0.05)
    await stop_feed_executor()
    release.set()
    assert await asyncio.gather(*running) == [True] * 4
    results = await asyncio.gather(*queued, return_exceptions=True)
    assert all(isinstance(result, asyncio.CancelledError) for result in results)
    assert await run_feed_lookup(lambda: 42) == 42


# Captured at import, before a test routes httpx.AsyncClient to a fake upstream
_ASYNC_CLIENT = httpx.AsyncClient


@pytest.mark.asyncio
async def test_stale_guide_answers_at_once_while_its_refresh_hangs(monkeypatch):
    """N-01: 40 current-programme reads behind a hung XMLTV refresh get the stale
    programme at once, start one fetch, and need no default-executor thread."""
    now = datetime.now(UTC)
    m3u_parser._cache.update(
        channels=[EPGChannel(id="ch1", name="One", stream_url="http://ersatztv.test/1")],
        timestamp=datetime.now(),
        last_successful_fetch=datetime.now(),
    )
    stale = Programme(
        id="ch1_stale",
        channel_id="ch1",
        title="Stale Show",
        start=now - timedelta(minutes=30),
        stop=now + timedelta(minutes=30),
    )
    guide._cache = {"ch1": [stale]}
    guide._cache_expires = now - timedelta(seconds=1)

    fetches = 0
    release = asyncio.Event()

    async def hang(request):
        nonlocal fetches
        fetches += 1
        await release.wait()
        return httpx.Response(503)

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: _ASYNC_CLIENT(transport=httpx.MockTransport(hang), **kwargs),
    )
    lookups = []
    real_lookup = ersatztv_epg.run_feed_lookup

    async def spy(function, *args, **kwargs):
        lookups.append(function)
        return await real_lookup(function, *args, **kwargs)

    monkeypatch.setattr(ersatztv_epg, "run_feed_lookup", spy)

    # A default executor whose only thread is busy: any to_thread would stall
    loop = asyncio.get_running_loop()
    busy = threading.Event()
    executor = ThreadPoolExecutor(max_workers=1)
    loop.set_default_executor(executor)
    blocker = loop.run_in_executor(None, busy.wait, 5)

    token = create_access_token({"sub": "viewer", "role": "viewer"})
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with _ASYNC_CLIENT(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as client:
            reads = [client.get("/api/ersatztv/current/ch1", headers=headers) for _ in range(40)]
            responses = await asyncio.wait_for(asyncio.gather(*reads), 1.0)
            assert fetches == 1
    finally:
        release.set()
        busy.set()
        await blocker
        await guide.aclose()
        executor.shutdown(wait=False)

    assert {response.status_code for response in responses} == {200}
    assert {response.json()["current"]["title"] for response in responses} == {"Stale Show"}
    # Only the M3U identity lookup still uses the feeds executor, and it is warm
    assert set(lookups) == {ersatztv_epg.get_channel_by_id}
