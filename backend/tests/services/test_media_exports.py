"""Immutable export inputs survive overlap, ring reuse and recorder shutdown."""

import asyncio
import json
import os
import subprocess
import sys
import threading
import time
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from loguru import logger

from app.config import settings
from app.services import highlight
from app.services.highlight import ChannelRecorder, HighlightService
from app.services.media_export import encode_file


async def test_simultaneous_exports_snapshot_before_ring_wrap_and_stop(tmp_path, monkeypatch):
    root = tmp_path / "recordings"
    root.mkdir()
    monkeypatch.setattr(settings, "highlight_temp_dir", str(root))
    recorder = ChannelRecorder("safe", "http://fixture")
    recorder.segment_dir = root / "recorder-private"
    assert recorder.segment_dir is not None
    recorder.segment_dir.mkdir()
    (recorder.segment_dir / "seg_000.ts").write_bytes(b"frame-zero")
    (recorder.segment_dir / "seg_001.ts").write_bytes(b"frame-one")
    (recorder.segment_dir / "segments.txt").write_text("seg_000.ts\nseg_001.ts\n")
    recorder.process = MagicMock()
    recorder.process.poll.return_value = None
    workspaces = []
    ready = asyncio.Event()
    release = asyncio.Event()

    async def encoder(source, output, format, start, end, **kwargs):
        workspaces.append(source.parent)
        if len(workspaces) == 2:
            ready.set()
        await release.wait()
        return (
            b"".join(path.read_bytes() for path in sorted(source.parent.glob("input_*.ts")))
            + f"{format}:{start}:{end}".encode()
        )

    with (
        patch("os.killpg"),
        patch("os.waitpid", return_value=(123, 4991)),
        patch("os.getpgid"),
        patch("app.services.highlight.encode_file", encoder),
    ):
        first = asyncio.create_task(recorder.save_highlight("mp4", 1, 3))
        second = asyncio.create_task(recorder.save_highlight("webm", 2, 4))
        await ready.wait()
        assert workspaces[0] != workspaces[1]
        assert recorder.segment_dir is not None
        (recorder.segment_dir / "seg_000.ts").write_bytes(b"wrapped-new-frames")
        await recorder.stop()
        release.set()
        assert await first == (b"frame-zeroframe-onemp4:1:3", None)
        assert await second == (b"frame-zeroframe-onewebm:2:4", None)
    assert all(not workspace.exists() for workspace in workspaces)


@pytest.mark.parametrize("failure", ["timeout", "cancel"])
async def test_export_failure_cleans_private_workspace(tmp_path, monkeypatch, failure):
    recorder = ChannelRecorder("safe", "http://fixture")
    recorder.process = MagicMock()
    recorder.process.poll.return_value = None
    recorder.segment_dir = tmp_path
    workspaces: list[Path] = []
    started = asyncio.Event()

    def snapshot(directory):
        workspaces.append(directory)
        return directory / "concat.txt", 0.0

    async def encode(*args, **kwargs):
        started.set()
        if failure == "timeout":
            raise TimeoutError
        await asyncio.Event().wait()

    with (
        patch.object(recorder, "_snapshot", snapshot),
        patch("app.services.highlight.encode_file", encode),
    ):
        task = asyncio.create_task(recorder.save_highlight())
        await started.wait()
        if failure == "cancel":
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            assert await task == (None, "Highlight creation timed out")
    assert not workspaces[0].exists()


async def test_cancel_encoding_kills_and_reaps_actual_harmless_child(tmp_path):
    real_popen = subprocess.Popen
    children: list[subprocess.Popen] = []

    def launch(_command, **kwargs):
        child = real_popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
        children.append(child)
        return child

    with patch("subprocess.Popen", launch):
        task = asyncio.create_task(
            encode_file(tmp_path / "input", tmp_path / "output", "mp4", None, None)
        )
        await asyncio.sleep(0.05)
        assert children[0].poll() is None
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert children[0].poll() is not None


def test_snapshot_logs_how_far_the_capture_ends_before_the_snapshot(tmp_path):
    recorder = ChannelRecorder("safe", "http://fixture")
    recorder.segment_dir = tmp_path
    now = time.time()
    # seg_002 is still being written (it follows the last listed entry), so it stays out.
    for name, age in [("seg_000.ts", 27.0), ("seg_001.ts", 7.0), ("seg_002.ts", 1.0)]:
        (tmp_path / name).write_bytes(name.encode())
        os.utime(tmp_path / name, (now - age, now - age))
    (tmp_path / "segments.txt").write_text("seg_000.ts\nseg_001.ts\n")
    recorder.process = MagicMock()
    output = StringIO()
    handler = logger.add(output, format="{message}", serialize=True, level="INFO")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    try:
        with patch("os.killpg"), patch("os.waitpid", return_value=(123, 4991)):
            _, ends_at = recorder._snapshot(workspace)
    finally:
        logger.remove(handler)
    records = [json.loads(line)["record"] for line in output.getvalue().splitlines()]
    extra = next(r["extra"] for r in records if r["extra"].get("event") == "highlight.capture")
    assert extra["channel_id"] == "safe"
    assert extra["segments"] == 2
    assert 7.0 <= extra["ends_before_snapshot_seconds"] < 8.0
    assert "tail_gap_seconds" not in extra
    # The capture ends when its newest included segment was last written.
    assert ends_at == pytest.approx(now - 7.0)
    assert sorted(path.name for path in workspace.glob("input_*.ts")) == [
        "input_000.ts",
        "input_001.ts",
    ]


async def test_capture_records_the_press_and_when_the_capture_ends(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    monkeypatch.setattr(settings, "highlight_enabled", True)

    class EndingRecorder(ChannelRecorder):
        async def capture(self, output: Path) -> float:
            output.write_bytes(b"snapshot")
            return 1_000.5

    service = HighlightService()
    service._recorders["channel-1"] = EndingRecorder("channel-1", "http://fixture")
    before = time.time()
    with patch("app.services.highlight.media_duration", AsyncMock(return_value=60.0)):
        capture, error = await service.create_capture("channel-1", owner="viewer")
    assert error is None and capture is not None
    assert before <= capture.pressed_at <= capture.created_at
    assert capture.ends_at == 1_000.5
    await service.captures.clear()


def recording(directory: Path, now: float) -> ChannelRecorder:
    """Two closed segments are listed; seg_002 is being written at the press."""
    recorder = ChannelRecorder("channel-1", "http://fixture")
    recorder.segment_dir = directory
    recorder.process = MagicMock()
    recorder.process.poll.return_value = None
    for name, age in [("seg_000.ts", 21.0), ("seg_001.ts", 11.0), ("seg_002.ts", 1.0)]:
        (directory / name).write_bytes(name.encode())
        os.utime(directory / name, (now - age, now - age))
    (directory / "segments.txt").write_text("seg_000.ts\nseg_001.ts\n")
    return recorder


async def test_capture_waits_for_the_segment_being_written_at_the_press(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(highlight, "TAIL_POLL_SECONDS", 0.01)
    segments = tmp_path / "recorder-private"
    segments.mkdir()
    recorder = recording(segments, time.time())
    service = HighlightService()
    service._recorders["channel-1"] = recorder
    inputs: list[bytes] = []

    async def encoder(source, output, format, start, end, **kwargs):
        inputs.extend(path.read_bytes() for path in sorted(source.parent.glob("input_*.ts")))
        output.write_bytes(b"snapshot")

    with (
        patch("os.killpg"),
        patch("os.waitpid", return_value=(123, 4991)),
        patch("app.services.highlight.encode_file", encoder),
        patch("app.services.highlight.media_duration", AsyncMock(return_value=30.0)),
    ):
        task = asyncio.create_task(service.create_capture("channel-1", owner="viewer"))
        await asyncio.sleep(0.1)
        assert not task.done()
        # The recorder closes seg_002 after the press and lists it.
        (segments / "seg_002.ts").write_bytes(b"seg_002.ts with the moment")
        (segments / "segments.txt").write_text("seg_000.ts\nseg_001.ts\nseg_002.ts\n")
        capture, error = await asyncio.wait_for(task, 2)
    assert error is None and capture is not None
    assert inputs == [b"seg_000.ts", b"seg_001.ts", b"seg_002.ts with the moment"]
    assert capture.ends_at >= capture.pressed_at
    await service.captures.clear()


async def test_capture_stops_waiting_for_a_stalled_segment(tmp_path, monkeypatch):
    monkeypatch.setattr(highlight, "TAIL_POLL_SECONDS", 0.01)
    monkeypatch.setattr(highlight, "TAIL_WAIT_CAP_SECONDS", 0.2)
    recorder = recording(tmp_path, time.time())
    started = time.monotonic()
    assert await recorder.wait_for_current_segment() is False
    assert 0.2 <= time.monotonic() - started < 1
    # Without the closed tail, the capture still ends at the last listed segment.
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with patch("os.killpg"), patch("os.waitpid", return_value=(123, 4991)):
        _, ends_at = recorder._snapshot(workspace)
    assert ends_at == pytest.approx((tmp_path / "seg_001.ts").stat().st_mtime)


async def test_capture_stops_waiting_when_the_recorder_exits(tmp_path, monkeypatch):
    monkeypatch.setattr(highlight, "TAIL_POLL_SECONDS", 0.01)
    recorder = recording(tmp_path, time.time())
    exited = MagicMock()
    exited.poll.return_value = 1
    recorder.process = exited
    started = time.monotonic()
    assert await recorder.wait_for_current_segment() is False
    assert time.monotonic() - started < 1


async def test_tail_wait_reads_the_segment_list_off_the_event_loop(tmp_path, monkeypatch):
    monkeypatch.setattr(highlight, "TAIL_POLL_SECONDS", 0.01)
    monkeypatch.setattr(highlight, "TAIL_WAIT_CAP_SECONDS", 0.05)
    recorder = recording(tmp_path, time.time())
    readers: list[int] = []
    read = ChannelRecorder._newest_listed_segment

    def reading(self: ChannelRecorder) -> str | None:
        readers.append(threading.get_ident())
        return read(self)

    monkeypatch.setattr(ChannelRecorder, "_newest_listed_segment", reading)
    assert await recorder.wait_for_current_segment() is False
    assert len(readers) >= 2
    assert threading.get_ident() not in readers
