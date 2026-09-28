"""Ages and deadlines run on the monotonic clock, so a host clock step moves none of them."""

import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.services import cast, highlight
from app.services.cast import CastService, CastSession
from app.services.highlight import (
    CAPTURE_TTL_SECONDS,
    DOWNLOAD_TOKEN_TTL_SECONDS,
    RECORDER_IDLE_TIMEOUT,
    Capture,
    CaptureStore,
    ChannelRecorder,
    HighlightService,
)


@pytest.fixture
def clock(monkeypatch):
    """One injected monotonic clock for both services; tests advance it by hand."""
    now = [10_000.0]
    monkeypatch.setattr(highlight, "monotonic", lambda: now[0])
    monkeypatch.setattr(cast, "monotonic", lambda: now[0])
    return now


def step_wall_clock(monkeypatch, seconds: float) -> None:
    real = time.time
    monkeypatch.setattr(time, "time", lambda: real() + seconds)


def polled_recorder(directory: Path) -> ChannelRecorder:
    recorder = ChannelRecorder("channel-1", "http://stream.url")
    recorder.process = MagicMock()
    recorder.process.poll.return_value = None
    recorder.segment_dir = directory
    (directory / "seg_000.ts").write_bytes(b"segment")
    recorder._output_seen_at = highlight.monotonic()
    recorder.touch()
    return recorder


def capture(directory: Path) -> Capture:
    path = directory / "snapshot.mp4"
    path.write_bytes(b"mp4")
    now = time.time()
    return Capture("synthetic-capture-0001", "viewer", "channel-1", path, 3, 2, now, now, now)


def cast_session() -> CastSession:
    session = CastSession("session", "channel-1", "http://stream.url", "hls")
    session.touch()
    return session


@pytest.mark.parametrize("step", [3600, -3600])
async def test_a_host_clock_step_stops_nothing_and_expires_nothing(
    tmp_path, monkeypatch, clock, step
):
    service = HighlightService()
    recorder = polled_recorder(tmp_path)
    service._recorders["channel-1"] = recorder
    store = CaptureStore()
    item = capture(tmp_path)
    store.captures[item.id] = item
    token = store.issue_download_token(item.id, "viewer")
    casting = CastService()
    session = cast_session()
    casting._sessions["session"] = session
    # A first watchdog pass sees the segment.
    await service._cleanup_idle_recorders()

    step_wall_clock(monkeypatch, step)
    clock[0] += 5
    with (
        patch.object(ChannelRecorder, "stop", AsyncMock()) as stop_recorder,
        patch.object(CastSession, "stop", AsyncMock()) as stop_session,
    ):
        await service._cleanup_idle_recorders()
        await store.sweep()
        await casting._cleanup_idle_sessions()
    stop_recorder.assert_not_awaited()
    stop_session.assert_not_awaited()
    assert service._recorders == {"channel-1": recorder}
    assert store.get(item.id, "viewer") is item
    assert token is not None and store.redeem_download_token(token) is item
    assert casting._sessions == {"session": session}


async def test_the_monotonic_clock_still_expires_everything(tmp_path, monkeypatch, clock):
    monkeypatch.setattr(settings, "cast_session_timeout", 300)
    service = HighlightService()
    service._recorders["channel-1"] = polled_recorder(tmp_path)
    store = CaptureStore()
    item = capture(tmp_path)
    store.captures[item.id] = item
    token = store.issue_download_token(item.id, "viewer")
    casting = CastService()
    casting._sessions["session"] = cast_session()

    clock[0] += DOWNLOAD_TOKEN_TTL_SECONDS + 1
    assert token is not None and store.redeem_download_token(token) is None
    clock[0] += max(RECORDER_IDLE_TIMEOUT, settings.cast_session_timeout, CAPTURE_TTL_SECONDS)
    with (
        patch.object(ChannelRecorder, "stop", AsyncMock()),
        patch.object(CastSession, "stop", AsyncMock()),
        patch("app.services.highlight.remove_recording_directory"),
    ):
        await service._cleanup_idle_recorders()
        assert store.get(item.id, "viewer") is None
        await store.sweep()
        await casting._cleanup_idle_sessions()
    assert service._recorders == {}
    assert store.captures == {}
    assert casting._sessions == {}
