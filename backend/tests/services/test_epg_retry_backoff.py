"""MEDIA-11: outage refresh outcome is shared, including stale fallback."""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.services.epg_service import EPGService


@pytest.mark.asyncio
async def test_failed_refresh_is_shared_until_retry_deadline():
    service = EPGService("http://synthetic.invalid")
    service._cache = {"synthetic": []}
    service._cache_expires = datetime.now(UTC) - timedelta(seconds=1)

    async def fail():
        await asyncio.sleep(0.02)
        return False

    with patch.object(service, "refresh_cache", side_effect=fail) as refresh:
        await asyncio.gather(*(service._ensure_cache() for _ in range(20)))
        await _settle(service)
        await _read(service)
        assert refresh.call_count == 1
    service._retry_at = datetime.now(UTC) - timedelta(seconds=1)
    with patch.object(service, "refresh_cache", new=AsyncMock(return_value=True)) as refresh:
        await _read(service)
        refresh.assert_awaited_once()
        assert service._retry_at is None


async def _settle(service: EPGService) -> None:
    """Wait for the background refresh a stale read started, if any."""
    if service._refresh_task is not None:
        await service._refresh_task


async def _read(service: EPGService) -> None:
    """A guide read, then the background refresh it may have started."""
    await service._ensure_cache()
    await _settle(service)


def _expired_service() -> EPGService:
    service = EPGService("http://synthetic.invalid")
    service._cache = {"synthetic": []}
    service._cache_expires = datetime.now(UTC) - timedelta(seconds=1)
    return service


async def _fail_once(service: EPGService) -> timedelta:
    """Run one refresh after the current deadline and return the backoff it set."""
    if service._retry_at is not None:
        service._retry_at = datetime.now(UTC) - timedelta(seconds=1)
    before = datetime.now(UTC)
    await _read(service)
    assert service._retry_at is not None
    return service._retry_at - before


def _assert_delay(delay: timedelta, seconds: int) -> None:
    assert timedelta(seconds=seconds) <= delay < timedelta(seconds=seconds, milliseconds=500)


@pytest.mark.asyncio
async def test_failed_refreshes_back_off_from_30s_doubling_to_five_minutes():
    service = _expired_service()

    with patch.object(service, "refresh_cache", new=AsyncMock(return_value=False)) as refresh:
        for expected in (30, 60, 120, 240, 300, 300):
            _assert_delay(await _fail_once(service), expected)
        assert refresh.await_count == 6


@pytest.mark.asyncio
async def test_calls_before_the_deadline_do_not_refresh():
    service = _expired_service()

    with patch.object(service, "refresh_cache", new=AsyncMock(return_value=False)) as refresh:
        for _ in range(5):
            await _read(service)
        refresh.assert_awaited_once()


@pytest.mark.asyncio
async def test_success_resets_the_backoff():
    service = _expired_service()

    with patch.object(service, "refresh_cache", new=AsyncMock(return_value=False)):
        for expected in (30, 60, 120):
            _assert_delay(await _fail_once(service), expected)

    service._retry_at = datetime.now(UTC) - timedelta(seconds=1)
    with patch.object(service, "refresh_cache", new=AsyncMock(return_value=True)):
        await _read(service)
    assert service._retry_at is None

    # refresh_cache is mocked, so the cache is still expired and the next failure starts over
    with patch.object(service, "refresh_cache", new=AsyncMock(return_value=False)):
        _assert_delay(await _fail_once(service), 30)
