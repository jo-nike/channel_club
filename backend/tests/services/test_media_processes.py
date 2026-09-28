"""Real harmless subprocess regressions: no FFmpeg or live upstream required."""

import asyncio
import subprocess
import sys
from io import StringIO
from unittest.mock import patch

import pytest
from loguru import logger

from app.config import settings
from app.services.cast import CastSession
from app.services.highlight import STDERR_LOG_MAX_BYTES, STDERR_LOG_NAME, ChannelRecorder


@pytest.mark.parametrize("kind", ["highlight", "cast"])
async def test_stderr_flood_does_not_block_progress_and_stop_reaps(tmp_path, monkeypatch, kind):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path / "highlights"))
    monkeypatch.setattr(settings, "cast_temp_dir", str(tmp_path / "cast"))
    recorder = (
        ChannelRecorder("safe", "http://fixture")
        if kind == "highlight"
        else CastSession("session", "safe", "http://fixture", "mpegts")
    )
    real_popen = subprocess.Popen
    children: list[subprocess.Popen] = []
    marker = tmp_path / "progress"

    def launch(command, **kwargs):
        # The recorder keeps stderr in a file for its failure log; neither side is a pipe.
        assert kwargs["stderr"] not in (subprocess.PIPE, None)
        if kind == "cast":
            assert kwargs["stderr"] == subprocess.DEVNULL
        assert kwargs["start_new_session"] is True
        script = (
            "import pathlib,sys,time; sys.stderr.write('x'*1048576); sys.stderr.flush(); "
            "pathlib.Path(sys.argv[1]).write_text('progress'); "
            "pathlib.Path(sys.argv[2]).write_text('#EXTM3U'); time.sleep(30)"
        )
        playlist = (
            str(recorder.playlist_path)
            if isinstance(recorder, CastSession)
            else str(tmp_path / "unused")
        )
        child = real_popen([sys.executable, "-c", script, str(marker), playlist], **kwargs)
        children.append(child)
        return child

    with patch("subprocess.Popen", launch):
        assert await asyncio.wait_for(recorder.start(), 3)
        assert marker.read_text() == "progress"
        await asyncio.wait_for(recorder.stop(), 3)
    assert children[0].poll() is not None


async def test_cast_ffmpeg_bounds_reads_from_a_stalled_source(tmp_path, monkeypatch):
    from app.services.highlight import RECORDER_RW_TIMEOUT_MICROSECONDS

    monkeypatch.setattr(settings, "cast_temp_dir", str(tmp_path))
    session = CastSession("session", "safe", "http://fixture", "mpegts")
    with patch("subprocess.Popen", side_effect=FileNotFoundError) as spawn:
        assert await session.start() is None
    command = spawn.call_args.args[0]
    timeout = command.index("-rw_timeout")
    assert command[timeout + 1] == str(RECORDER_RW_TIMEOUT_MICROSECONDS)
    assert timeout < command.index("-i")


async def test_a_failed_recorder_start_logs_ffmpeg_stderr_redacted(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    recorder = ChannelRecorder("safe", "http://fixture")
    real_popen = subprocess.Popen
    script = (
        "import sys; sys.stderr.write('x' * 2000 + '\\n'); "
        "sys.stderr.write('http://source/live?token=SECRET123: Server returned 403 Forbidden\\n');"
        " sys.exit(8)"
    )

    def launch(_command, **kwargs):
        return real_popen([sys.executable, "-c", script], **kwargs)

    output = StringIO()
    handler = logger.add(output, format="{message}", level="ERROR")
    try:
        with patch("subprocess.Popen", launch):
            assert await recorder.start() is False
    finally:
        logger.remove(handler)
    line = output.getvalue()
    assert "exit status 8" in line and "Server returned 403 Forbidden" in line
    assert "SECRET123" not in line and "token=[REDACTED]" in line
    # Only the tail is logged, and the segment directory is still removed afterwards.
    assert "x" * 600 not in line
    assert not list(tmp_path.iterdir())


async def test_the_stderr_file_is_trimmed_and_ffmpeg_writes_from_its_start(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    recorder = ChannelRecorder("safe", "http://fixture")
    real_popen = subprocess.Popen
    go = tmp_path / "go"
    # Past the cap, then one more line once the test has trimmed the file
    script = (
        f"import pathlib,sys,time; sys.stderr.write('x' * {STDERR_LOG_MAX_BYTES + 1}); "
        "sys.stderr.flush(); p = pathlib.Path(sys.argv[1])\n"
        "while not p.exists(): time.sleep(0.02)\n"
        "sys.stderr.write('after trim\\n'); sys.stderr.flush(); time.sleep(30)"
    )

    def launch(_command, **kwargs):
        return real_popen([sys.executable, "-c", script, str(go)], **kwargs)

    with patch("subprocess.Popen", launch):
        assert await asyncio.wait_for(recorder.start(), 3)
    assert recorder.segment_dir is not None
    log_file = recorder.segment_dir / STDERR_LOG_NAME
    for _ in range(100):
        if log_file.stat().st_size > STDERR_LOG_MAX_BYTES:
            break
        await asyncio.sleep(0.02)
    try:
        recorder.trim_stderr_log()
        assert log_file.stat().st_size == 0
        go.touch()
        for _ in range(100):
            if log_file.stat().st_size:
                break
            await asyncio.sleep(0.02)
        assert log_file.read_bytes() == b"after trim\n"
    finally:
        await asyncio.wait_for(recorder.stop(), 3)
