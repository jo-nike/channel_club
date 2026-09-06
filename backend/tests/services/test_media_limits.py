"""Admission is tested with controlled jobs, never a resource stress workload."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.config import settings
from app.services.cast import CastService, CastSession
from app.services.highlight import HighlightService
from app.services.media_limits import export_budget, process_budget


@pytest.fixture(autouse=True)
def budgets(monkeypatch):
    process_budget.owners.clear()
    export_budget.owners.clear()
    monkeypatch.setattr(settings, "cast_enabled", True)
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(settings, "media_process_limit", 3)
    monkeypatch.setattr(settings, "media_process_per_user", 2)
    monkeypatch.setattr(settings, "media_export_limit", 2)
    monkeypatch.setattr(settings, "media_export_per_user", 1)
    yield
    process_budget.owners.clear()
    export_budget.owners.clear()


async def test_cast_limits_before_start_and_failed_cancelled_slots_release():
    service = CastService()
    started = asyncio.Event()
    release = asyncio.Event()

    async def start(_self):
        started.set()
        await release.wait()
        return "/fixture"

    with (
        patch.object(CastSession, "start", start),
        patch.object(CastSession, "stop", AsyncMock()) as stop,
    ):
        jobs = [
            asyncio.create_task(service.create_session("same", "http://fixture", "mpegts", "alice"))
            for _ in range(2)
        ]
        await started.wait()
        with pytest.raises(HTTPException) as exc:
            await service.create_session("same", "http://fixture", "mpegts", "alice")
        assert exc.value.status_code == 429
        third = asyncio.create_task(
            service.create_session("same", "http://fixture", "mpegts", "bob")
        )
        await asyncio.sleep(0)
        with pytest.raises(HTTPException):
            await service.create_session("same", "http://fixture", "mpegts", "carol")
        for job in [*jobs, third]:
            job.cancel()
        await asyncio.gather(*jobs, third, return_exceptions=True)
        assert not process_budget.owners
        assert not service._sessions
        assert stop.await_count == 3
    with (
        patch.object(CastSession, "start", AsyncMock(return_value=None)),
        patch.object(CastSession, "stop", AsyncMock()),
    ):
        assert await service.create_session("same", "http://fixture", "mpegts", "alice") is None
        assert not process_budget.owners


async def test_export_overload_never_enters_recorder_and_cancel_releases():
    service = HighlightService()
    entered = asyncio.Event()

    async def save(**_kwargs):
        entered.set()
        await asyncio.Event().wait()

    recorder = AsyncMock()
    recorder.save_highlight.side_effect = save
    service._recorders["same"] = recorder
    job = asyncio.create_task(service.save_highlight("same", owner="alice"))
    await entered.wait()
    with pytest.raises(HTTPException):
        await service.save_highlight("same", owner="alice")
    assert recorder.save_highlight.await_count == 1
    job.cancel()
    await asyncio.gather(job, return_exceptions=True)
    assert not export_budget.owners


async def test_dead_recorder_reclaimed_with_budget():
    service = HighlightService()
    recorder = AsyncMock()
    recorder.is_running = False
    service._recorders["dead"] = recorder
    service._owners["dead"] = "alice"
    process_budget.acquire("alice")
    await service._cleanup_idle_recorders()
    recorder.stop.assert_awaited_once()
    assert not service._recorders
    assert not process_budget.owners
