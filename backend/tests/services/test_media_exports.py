"""Immutable export inputs survive overlap, ring reuse and recorder shutdown."""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from loguru import logger

from app.config import settings
from app.services import highlight, media_export
from app.services.highlight import ChannelRecorder, HighlightService
from app.services.media_export import encode_file


async def test_simultaneous_captures_snapshot_before_ring_wrap_and_stop(tmp_path, monkeypatch):
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
        output.write_bytes(
            b"".join(path.read_bytes() for path in sorted(source.parent.glob("input_*.ts")))
        )
        return output

    outputs = [tmp_path / "first.mp4", tmp_path / "second.mp4"]
    with (
        patch("os.killpg"),
        patch("os.waitpid", return_value=(123, 4991)),
        patch("os.getpgid"),
        patch("app.services.highlight.encode_file", encoder),
    ):
        first = asyncio.create_task(recorder.capture(outputs[0]))
        second = asyncio.create_task(recorder.capture(outputs[1]))
        await ready.wait()
        assert workspaces[0] != workspaces[1]
        assert recorder.segment_dir is not None
        (recorder.segment_dir / "seg_000.ts").write_bytes(b"wrapped-new-frames")
        await recorder.stop()
        release.set()
        await first
        await second
    assert [output.read_bytes() for output in outputs] == [b"frame-zeroframe-one"] * 2
    assert all(not workspace.exists() for workspace in workspaces)


@pytest.mark.parametrize("failure", ["timeout", "cancel"])
async def test_capture_failure_cleans_private_workspace(tmp_path, monkeypatch, failure):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
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
        task = asyncio.create_task(recorder.capture(tmp_path / "snapshot.mp4"))
        await started.wait()
        if failure == "cancel":
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(TimeoutError):
                await task
    assert not workspaces[0].exists()


async def test_cancel_encoding_kills_and_reaps_actual_harmless_child(tmp_path):
    real_exec = asyncio.create_subprocess_exec
    children: list[asyncio.subprocess.Process] = []

    async def launch(*_command, **kwargs):
        child = await real_exec(sys.executable, "-c", "import time; time.sleep(30)", **kwargs)
        children.append(child)
        return child

    with patch("asyncio.create_subprocess_exec", launch):
        task = asyncio.create_task(
            encode_file(tmp_path / "input", tmp_path / "output", "mp4", None, None)
        )
        await asyncio.sleep(0.2)
        assert children[0].returncode is None
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    # Reaped before the cancellation propagated, not merely signalled.
    assert children[0].returncode is not None


@pytest.fixture
async def busy_executor():
    """Hold the default executor's only worker until `release()` (the N-02 saturation)."""
    loop = asyncio.get_running_loop()
    executor = ThreadPoolExecutor(max_workers=1)
    loop.set_default_executor(executor)
    gate = threading.Event()
    loop.run_in_executor(None, gate.wait)
    yield gate.set
    gate.set()
    executor.shutdown(wait=True)


@pytest.fixture
def source_mp4(tmp_path):
    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg required")
    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=red:s=32x32:r=4:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        check=True,
        timeout=15,
    )
    return source


async def test_a_busy_executor_never_makes_a_finished_encode_time_out(
    tmp_path, monkeypatch, busy_executor, source_mp4
):
    monkeypatch.setattr(media_export, "REMUX_TIMEOUT_SECONDS", 1)
    # The remux takes a fraction of a second; the worker thread frees only after the timeout.
    asyncio.get_running_loop().call_later(1.5, busy_executor)
    await asyncio.wait_for(encode_file(source_mp4, tmp_path / "out.mp4", "mp4", None, None), 10)
    assert (tmp_path / "out.mp4").stat().st_size > 0


async def test_a_busy_executor_never_delays_or_times_out_a_probe(
    monkeypatch, busy_executor, source_mp4
):
    monkeypatch.setattr(media_export, "PROBE_TIMEOUT_SECONDS", 1)
    # The probe takes a fraction of a second; the worker thread frees only after the timeout.
    loop = asyncio.get_running_loop()
    loop.call_later(1.5, busy_executor)
    started = loop.time()
    duration = await asyncio.wait_for(media_export.media_duration(source_mp4), 10)
    assert duration > 0
    assert loop.time() - started < 1.5


async def test_cancel_probe_kills_and_reaps_actual_harmless_child(tmp_path):
    real_exec = asyncio.create_subprocess_exec
    children: list[asyncio.subprocess.Process] = []

    async def launch(*_command, **kwargs):
        child = await real_exec(sys.executable, "-c", "import time; time.sleep(30)", **kwargs)
        children.append(child)
        return child

    with patch("asyncio.create_subprocess_exec", launch):
        task = asyncio.create_task(media_export.media_duration(tmp_path / "input.mp4"))
        await asyncio.sleep(0.2)
        assert children[0].returncode is None
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    # Reaped before the cancellation propagated, not merely signalled.
    assert children[0].returncode is not None


async def test_encode_returns_the_output_file_without_reading_it(tmp_path, source_mp4):
    output = tmp_path / "out.mp4"
    with patch.object(Path, "read_bytes", side_effect=AssertionError("read into memory")):
        assert await encode_file(source_mp4, output, "mp4", None, None) == output
    assert output.stat().st_size > 0


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
        async def wait_for_current_segment(self) -> bool:
            return True

        async def capture(self, output: Path) -> float:
            output.write_bytes(b"snapshot")
            return 1_000.5

    service = HighlightService()
    recorder = EndingRecorder("channel-1", "http://fixture")
    recorder.process = MagicMock()
    recorder.process.poll.return_value = None
    service._recorders["channel-1"] = recorder
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
