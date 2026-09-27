"""Immutable export inputs survive overlap, ring reuse and recorder shutdown."""

import asyncio
import json
import os
import subprocess
import sys
import time
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from loguru import logger

from app.config import settings
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


def test_snapshot_logs_how_far_the_capture_ends_before_the_press(tmp_path):
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
    assert 7.0 <= extra["tail_gap_seconds"] < 8.0
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
