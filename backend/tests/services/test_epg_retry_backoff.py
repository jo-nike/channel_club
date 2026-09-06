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
        await service._ensure_cache()
        assert refresh.call_count == 1
    service._retry_at = datetime.now(UTC) - timedelta(seconds=1)
    with patch.object(service, "refresh_cache", new=AsyncMock(return_value=True)) as refresh:
        await service._ensure_cache()
        refresh.assert_awaited_once()
        assert service._retry_at is None
