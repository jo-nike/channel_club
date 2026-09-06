"""Real harmless subprocess regressions: no FFmpeg or live upstream required."""

import asyncio
import subprocess
import sys
from unittest.mock import patch

import pytest

from app.config import settings
from app.services.cast import CastSession
from app.services.highlight import ChannelRecorder


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
