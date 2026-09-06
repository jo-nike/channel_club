"""Real synthetic FFmpeg wrap cycles verify bounded completed-segment metadata."""

import shutil
import subprocess
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.services.highlight import ChannelRecorder


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg required for muxer regression")
async def test_real_segment_muxer_bounds_manifest_across_many_wraps(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    monkeypatch.setattr(settings, "highlight_buffer_seconds", 2)
    monkeypatch.setattr(settings, "highlight_segment_seconds", 1)
    recorder = ChannelRecorder("safe", "http://unused")
    process = MagicMock()
    process.poll.return_value = None
    with (
        patch("subprocess.Popen", return_value=process) as launch,
        patch("asyncio.sleep", AsyncMock()),
    ):
        assert await recorder.start()
        production = launch.call_args.args[0]
    start = production.index("-f")
    # Use the actual production muxer options, replacing only its network input/codec.
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=32x32:rate=2",
        "-t",
        "40",
        "-c:v",
        "mpeg2video",
        "-g",
        "2",
        *production[start:],
    ]
    subprocess.run(command, check=True, timeout=20, capture_output=True)
    assert recorder.segment_dir is not None
    lines = (recorder.segment_dir / "segments.txt").read_text().splitlines()
    assert len(lines) == 3
    assert len(list(recorder.segment_dir.glob("seg_*.ts"))) <= 4
    indexes = [int(line[4:7]) for line in lines]
    assert all(right == (left + 1) % 4 for left, right in zip(indexes, indexes[1:], strict=False))
    recorder.process = None
    await recorder.stop()
