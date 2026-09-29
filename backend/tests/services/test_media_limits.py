"""Admission is tested with controlled jobs, never a resource stress workload."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.config import settings
from app.services.cast import CastService, CastSession
from app.services.highlight import RECORDER_OWNER, HighlightService
from app.services.media_limits import export_budget, process_budget, recorder_budget


@pytest.fixture(autouse=True)
def budgets(monkeypatch):
    process_budget.owners.clear()
    export_budget.owners.clear()
    monkeypatch.setattr(settings, "cast_enabled", True)
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(settings, "media_process_limit", 3)
    monkeypatch.setattr(settings, "media_process_per_user", 2)
    monkeypatch.setattr(settings, "media_recorder_limit", 2)
    monkeypatch.setattr(settings, "media_recorder_per_user", 2)
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


async def test_capture_overload_never_enters_recorder_and_cancel_releases():
    service = HighlightService()
    entered = asyncio.Event()

    async def create(*_args):
        entered.set()
        await asyncio.Event().wait()

    recorder = AsyncMock()
    recorder.is_running = True
    # No closed segment to key on, so every press makes its own snapshot.
    recorder._newest_listed_segment_stamp = MagicMock(return_value=None)
    service._recorders["same"] = recorder
    with patch.object(service.captures, "create", AsyncMock(side_effect=create)) as creating:
        job = asyncio.create_task(service.create_capture("same", owner="alice"))
        await entered.wait()
        # Alice's second press queues for her one slot instead of entering the recorder.
        queued = asyncio.create_task(service.create_capture("same", owner="alice"))
        await asyncio.sleep(0.05)
        assert not queued.done()
        assert creating.await_count == 1
        job.cancel()
        queued.cancel()
        await asyncio.gather(job, queued, return_exceptions=True)
    assert not export_budget.owners


async def test_dead_recorder_reclaimed_with_budget():
    service = HighlightService()
    recorder = AsyncMock()
    recorder.is_running = False
    service._recorders["dead"] = recorder
    service._owners["dead"] = RECORDER_OWNER
    recorder_budget.acquire(RECORDER_OWNER)
    await service._cleanup_idle_recorders()
    recorder.stop.assert_awaited_once()
    assert not service._recorders
    assert not recorder_budget.owners


def fake_source(channel_id: str):
    from types import SimpleNamespace

    from app.models.channel import Channel

    channel = Channel(id=channel_id, name="New", streamUrl="https://source/ts", guideId="1")
    return SimpleNamespace(channel=channel)


async def test_optional_highlights_defer_at_capacity_and_recover():
    from app.services.highlight import ChannelRecorder

    service = HighlightService()
    for _ in range(2):
        recorder_budget.acquire(RECORDER_OWNER)
    with (
        patch(
            "app.services.highlight.resolve_media_channel",
            AsyncMock(return_value=fake_source("new")),
        ) as resolve,
        patch.object(ChannelRecorder, "start", AsyncMock(return_value=True)) as start,
        patch.object(ChannelRecorder, "stop", AsyncMock()),
    ):
        assert await service.start_recording("new", "", owner="alice") is False
        assert recorder_budget.owners[RECORDER_OWNER] == 2
        resolve.assert_not_called()
        start.assert_not_called()
        recorder_budget.release(RECORDER_OWNER)
        assert await service.start_recording("new", "", owner="alice") is True
        assert recorder_budget.owners[RECORDER_OWNER] == 2
        assert not process_budget.owners
        await service.stop_all()
        assert recorder_budget.owners[RECORDER_OWNER] == 1


async def test_recorders_a_viewer_polled_never_block_their_cast():
    from app.services.highlight import ChannelRecorder

    service = HighlightService()
    with (
        patch(
            "app.services.highlight.resolve_media_channel",
            AsyncMock(side_effect=lambda channel_id: fake_source(channel_id)),
        ),
        patch.object(ChannelRecorder, "start", AsyncMock(return_value=True)),
        patch.object(ChannelRecorder, "stop", AsyncMock()),
        patch.object(CastSession, "start", AsyncMock(return_value="/fixture")),
        patch.object(CastSession, "stop", AsyncMock()),
    ):
        for channel_id in ("one", "two"):
            assert await service.start_recording(channel_id, "", owner="alice") is True
        cast = CastService()
        assert await cast.create_session("one", "http://fixture", "mpegts", "alice") is not None
        assert await cast.create_session("two", "http://fixture", "mpegts", "alice") is not None
        assert process_budget.owners == {"alice": 2}
        await cast.stop_all()
        await service.stop_all()
    assert not process_budget.owners and not recorder_budget.owners


def recorder_polled(seconds_ago: float) -> AsyncMock:
    import time

    recorder = AsyncMock()
    recorder.is_running = True
    recorder.last_activity = time.monotonic() - seconds_ago
    return recorder


def full_of(service: HighlightService, polled: dict[str, float]) -> dict[str, AsyncMock]:
    recorders = {
        channel_id: recorder_polled(seconds_ago) for channel_id, seconds_ago in polled.items()
    }
    for channel_id, recorder in recorders.items():
        service._recorders[channel_id] = recorder
        service._owners[channel_id] = RECORDER_OWNER
        recorder_budget.acquire(RECORDER_OWNER)
    return recorders


async def test_full_recorder_budget_evicts_the_recorder_unpolled_longest():
    from app.services.highlight import ChannelRecorder

    service = HighlightService()
    oldest = full_of(service, {"recent": 20, "oldest": 40})["oldest"]
    with (
        patch(
            "app.services.highlight.resolve_media_channel",
            AsyncMock(return_value=fake_source("new")),
        ),
        patch.object(ChannelRecorder, "start", AsyncMock(return_value=True)),
        patch.object(ChannelRecorder, "stop", AsyncMock()),
    ):
        assert await service.start_recording("new", "") is True
    oldest.stop.assert_awaited_once()
    assert sorted(service._recorders) == ["new", "recent"]
    assert recorder_budget.owners[RECORDER_OWNER] == 2


@pytest.mark.parametrize("live", [False, True])
async def test_recently_polled_and_live_recorders_are_never_evicted(live):
    from app.models.channel import Channel
    from app.services import channel_state
    from app.services.highlight import ChannelRecorder

    service = HighlightService()
    # Without a Live channel both are polled too recently; with one, the Live recorder is stale.
    recorders = full_of(service, {"recent": 5, "live": 30 if live else 5})
    if live:
        channel_state._current_channel = Channel(
            id="live", name="Live", streamUrl="https://source/ts", guideId="1"
        )
    with (
        patch("app.services.highlight.resolve_media_channel", AsyncMock()) as resolve,
        patch.object(ChannelRecorder, "start", AsyncMock(return_value=True)) as start,
    ):
        assert await service.start_recording("new", "") is False
    resolve.assert_not_called()
    start.assert_not_called()
    assert sorted(service._recorders) == ["live", "recent"]
    for recorder in recorders.values():
        recorder.stop.assert_not_awaited()
    assert recorder_budget.owners[RECORDER_OWNER] == 2


async def test_status_poll_at_capacity_returns_unavailable_without_error():
    from fastapi.testclient import TestClient

    from app.main import app
    from app.services.auth import create_access_token

    service = HighlightService()
    for _ in range(2):
        recorder_budget.acquire(RECORDER_OWNER)
    token = create_access_token({"sub": "alice", "role": "viewer"})
    with (
        patch("app.routers.highlight.highlight_service", service),
        patch("app.services.highlight.resolve_media_channel", AsyncMock()) as resolve,
    ):
        response = TestClient(app).get(
            "/api/highlight/status/new", headers={"Authorization": f"Bearer {token}"}
        )
    assert response.status_code == 200
    assert response.json()["enabled"] is True
    assert response.json()["recording"] is False
    assert response.json()["bufferSeconds"] == 0
    assert recorder_budget.owners[RECORDER_OWNER] == 2
    resolve.assert_not_called()


@pytest.mark.parametrize("failure", [False, True])
async def test_channel_selection_broadcasts_even_when_highlights_unavailable(failure):
    from app.models.channel import Channel
    from app.services import channel_state

    service = HighlightService()
    channel = Channel(id="new", name="New", streamUrl="https://source/ts", guideId="1")
    for _ in range(2):
        recorder_budget.acquire(RECORDER_OWNER)
    channel_state.clear_current_channel()
    try:
        with (
            patch("app.services.highlight.highlight_service", service),
            patch("app.services.channel_state.broadcast_channel_update", AsyncMock()) as broadcast,
        ):
            if failure:
                with patch.object(service, "start_recording", AsyncMock(side_effect=RuntimeError)):
                    result = await channel_state.set_current_channel(channel, user="alice")
            else:
                result = await channel_state.set_current_channel(channel, user="alice")
            assert result == channel
            assert channel_state.get_current_channel() == channel
            broadcast.assert_awaited_once_with(channel, changed_by="alice")
    finally:
        channel_state.clear_current_channel()


async def test_a_waiter_takes_a_released_slot_and_a_long_wait_is_429():
    export_budget.acquire("alice")
    export_budget.acquire("bob")
    waiter = asyncio.create_task(export_budget.wait_acquire("carol"))
    await asyncio.sleep(0.01)
    assert not waiter.done()
    export_budget.release("alice")
    await asyncio.wait_for(waiter, 1)
    assert export_budget.owners == {"bob": 1, "carol": 1}
    with pytest.raises(HTTPException) as exc:
        await export_budget.wait_acquire("dave", timeout=0.05)
    assert exc.value.status_code == 429
    assert "dave" not in export_budget.owners and not export_budget._waiters


async def test_a_cancelled_waiter_never_takes_the_slot():
    export_budget.acquire("alice")
    export_budget.acquire("bob")
    waiter = asyncio.create_task(export_budget.wait_acquire("carol"))
    await asyncio.sleep(0.01)
    # The slot frees up in the same tick the request is cancelled (the client left).
    export_budget.release("alice")
    waiter.cancel()
    await asyncio.gather(waiter, return_exceptions=True)
    assert export_budget.owners == {"bob": 1}
    assert not export_budget._waiters


async def test_everyone_who_clips_the_same_moment_gets_a_capture():
    service = HighlightService()
    recorder = AsyncMock()
    recorder.is_running = True
    # No closed segment to key on, so every press makes its own snapshot.
    recorder._newest_listed_segment_stamp = MagicMock(return_value=None)
    service._recorders["same"] = recorder
    running = 0
    peak = 0

    async def create(_recorder, owner, _channel_id, _pressed_at, _key):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.05)
        running -= 1
        return owner

    with patch.object(service.captures, "create", create):
        results = await asyncio.gather(
            *(service.create_capture("same", owner=f"viewer-{n}") for n in range(5))
        )
    assert results == [(f"viewer-{n}", None) for n in range(5)]
    assert peak == 2
    assert not export_budget.owners
