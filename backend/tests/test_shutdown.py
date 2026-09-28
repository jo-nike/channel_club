"""Shutdown teardown finishes inside Docker's stop grace period (G-07, K-04)."""

import asyncio
import os
import subprocess
import threading
import time
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from loguru import logger

from app import main
from app.config import settings
from app.services import highlight
from app.services.cast import CastService
from app.services.highlight import ChannelRecorder, HighlightService


class SlowRecorder(ChannelRecorder):
    """A recorder whose FFmpeg takes a second to exit."""

    def __init__(self, channel_id: str) -> None:
        super().__init__(channel_id, "https://source/ts")
        self.stopped = False

    async def stop(self) -> None:
        await asyncio.sleep(1)
        self.stopped = True


def run_app_and_time_shutdown() -> float:
    with patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])):
        client = TestClient(main.app)
        client.__enter__()
        started = time.monotonic()
        client.__exit__(None, None, None)
    return time.monotonic() - started


def test_recorders_stop_concurrently(monkeypatch: pytest.MonkeyPatch) -> None:
    service = HighlightService()
    recorders = [SlowRecorder(f"channel-{index}") for index in range(3)]
    for recorder in recorders:
        service._recorders[recorder.channel_id] = recorder
    monkeypatch.setattr(main, "highlight_service", service)

    elapsed = run_app_and_time_shutdown()

    assert all(recorder.stopped for recorder in recorders)
    assert service._recorders == {}
    assert elapsed < 2


def test_hung_teardown_is_cut_off_at_the_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    class HungCast(CastService):
        async def stop_all(self) -> None:
            await asyncio.Event().wait()

    service = HighlightService()
    recorder = SlowRecorder("channel-1")
    service._recorders[recorder.channel_id] = recorder
    monkeypatch.setattr(main, "highlight_service", service)
    monkeypatch.setattr(main, "cast_service", HungCast())
    monkeypatch.setattr(main, "SHUTDOWN_DEADLINE_SECONDS", 1.5)
    output = StringIO()
    handler_id = logger.add(output, format="{level} | {message}", level="WARNING")
    try:
        elapsed = run_app_and_time_shutdown()
    finally:
        logger.remove(handler_id)

    assert recorder.stopped
    assert elapsed < 3
    assert "WARNING | Shutdown teardown cut off at its 1.5s deadline" in output.getvalue()


def test_teardown_failure_is_logged_and_the_rest_still_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class BrokenCast(CastService):
        async def stop_all(self) -> None:
            raise RuntimeError("cast teardown broke")

    service = HighlightService()
    recorder = SlowRecorder("channel-1")
    service._recorders[recorder.channel_id] = recorder
    monkeypatch.setattr(main, "highlight_service", service)
    monkeypatch.setattr(main, "cast_service", BrokenCast())
    output = StringIO()
    handler_id = logger.add(output, format="{level} | {message}", level="WARNING")
    try:
        run_app_and_time_shutdown()
    finally:
        logger.remove(handler_id)

    assert recorder.stopped
    assert "Shutdown teardown failed: RuntimeError('cast teardown broke')" in output.getvalue()


async def test_stop_idle_cleanup_task_waits_for_the_task() -> None:
    for service in (HighlightService(), CastService()):
        service.start_idle_cleanup_task()
        task = service._cleanup_task
        assert task is not None

        await service.stop_idle_cleanup_task()

        assert task.done()
        assert service._cleanup_task is None


async def test_cancelled_idle_stop_still_signals_ffmpeg_before_removing_its_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """K-04: the sweep is cancelled while its terminate waits for a worker."""
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    segment_dir = tmp_path / "channel-1"
    segment_dir.mkdir()
    process = subprocess.Popen(["sleep", "30"], start_new_session=True)
    recorder = ChannelRecorder("channel-1", "https://source/ts")
    recorder.process = process
    recorder.segment_dir = segment_dir
    recorder.last_activity = 1  # idle for decades
    service = HighlightService()
    service._recorders["channel-1"] = recorder

    events: list[str] = []
    entered, gate = threading.Event(), threading.Event()
    real_killpg, real_remove = os.killpg, highlight.remove_recording_directory

    def killpg(pgid: int, signal: int) -> None:
        entered.set()
        assert gate.wait(5)
        events.append(f"signal {signal}")
        real_killpg(pgid, signal)

    def remove(directory: Path) -> None:
        events.append("remove")
        real_remove(directory)

    monkeypatch.setattr(highlight.os, "killpg", killpg)
    monkeypatch.setattr(highlight, "remove_recording_directory", remove)
    try:
        service._cleanup_task = asyncio.create_task(service._cleanup_idle_recorders())
        assert await asyncio.to_thread(entered.wait, 5)
        asyncio.get_running_loop().call_later(0.2, gate.set)

        await service.stop_idle_cleanup_task()
        await service.stop_all()

        assert events == ["signal 15", "remove"]
        assert process.poll() is not None
        assert not segment_dir.exists()
        assert service._recorders == {}
    finally:
        gate.set()
        if process.poll() is None:
            process.kill()
            process.wait()
