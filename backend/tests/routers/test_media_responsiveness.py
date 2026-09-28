"""MEDIA-02: a stalled synchronous feed must not stall unrelated ASGI work."""

import asyncio
import threading
from unittest.mock import patch

import httpx
import pytest

from app.main import app
from app.services.ersatztv.m3u_parser import parse_m3u_playlist
from app.services.ersatztv.refresh import (
    FeedUnavailableError,
    run_feed_lookup,
    stop_feed_executor,
)


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


@pytest.mark.asyncio
async def test_parallel_cold_feed_failure_is_shared():
    attempts = 0

    def fetch(_url):
        nonlocal attempts
        attempts += 1
        raise ValueError("controlled upstream unavailable")

    with patch("app.services.ersatztv.m3u_parser.fetch_feed", side_effect=fetch):
        results = await asyncio.gather(
            *[asyncio.to_thread(parse_m3u_playlist) for _ in range(20)], return_exceptions=True
        )
    assert all(isinstance(result, FeedUnavailableError) for result in results)
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
