"""MEDIA-02: a stalled synchronous feed must not stall unrelated ASGI work."""

import asyncio
import threading
from unittest.mock import patch

import httpx
import pytest

from app.main import app
from app.services.ersatztv.refresh import serialized_refresh


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

    @serialized_refresh
    def fetch():
        nonlocal attempts
        attempts += 1
        raise ValueError("controlled upstream unavailable")

    results = await asyncio.gather(
        *[asyncio.to_thread(fetch) for _ in range(20)], return_exceptions=True
    )
    assert all(isinstance(result, Exception) for result in results)
    assert attempts == 1
