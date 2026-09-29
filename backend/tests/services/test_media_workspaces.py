"""Request workspaces live under the swept recording root and are removed off the loop."""

import asyncio
import shutil
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.config import settings
from app.services import cast, media_export
from app.services.cast import CastSession
from app.services.highlight import ChannelRecorder, HighlightService
from app.services.media_export import workspace


@pytest.fixture
def removals(monkeypatch):
    """Record which thread each recursive delete runs on, then delete for real."""
    threads: list[int] = []
    real_rmtree = shutil.rmtree

    def rmtree(path, *args, **kwargs):
        threads.append(threading.get_ident())
        real_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(media_export.shutil, "rmtree", rmtree)
    return threads


@pytest.mark.parametrize("ending", ["normal", "error", "cancel"])
async def test_workspace_is_under_the_recording_root_and_removed_off_the_loop(
    tmp_path, monkeypatch, removals, ending
):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    entered = asyncio.Event()
    made: list[Path] = []

    async def use() -> None:
        async with workspace("highlight-export-") as directory:
            made.append(directory)
            (directory / "clip.mp4").write_bytes(b"clip")
            entered.set()
            if ending == "error":
                raise OSError("encode failed")
            if ending == "cancel":
                await asyncio.Event().wait()

    task = asyncio.create_task(use())
    await entered.wait()
    if ending == "cancel":
        task.cancel()
    results = await asyncio.gather(task, return_exceptions=True)
    assert (ending == "normal") == (results == [None])
    assert made[0].parent == tmp_path / "work"
    assert made[0].name.startswith("highlight-export-")
    assert not made[0].exists()
    assert removals and threading.get_ident() not in removals


def test_startup_sweep_removes_leftover_workspaces(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    leftover = tmp_path / "work" / "highlight-export-x"
    leftover.mkdir(parents=True)
    (leftover / "export.mp4").write_bytes(b"killed mid-encode")
    HighlightService().cleanup_stale_segments()
    assert not leftover.exists()


async def test_capture_workspace_is_under_the_recording_root(tmp_path, monkeypatch, removals):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    recorder = ChannelRecorder("safe", "http://fixture")
    recorder.process = MagicMock()
    recorder.process.poll.return_value = None
    recorder.segment_dir = tmp_path
    workspaces: list[Path] = []

    def snapshot(directory):
        workspaces.append(directory)
        return directory / "concat.txt", 0.0

    async def encode(source, output, *args, **kwargs):
        output.write_bytes(b"snapshot")
        return output

    with (
        patch.object(recorder, "_snapshot", snapshot),
        patch("app.services.highlight.encode_file", encode),
    ):
        await recorder.capture(tmp_path / "snapshot.mp4")
    assert workspaces[0].parent == tmp_path / "work"
    assert not workspaces[0].exists()
    assert threading.get_ident() not in removals


async def test_cast_stop_removes_its_directory_off_the_loop(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "cast_temp_dir", str(tmp_path))
    session = CastSession("session", "safe", "http://fixture", "mpegts")
    directory = tmp_path / "session"
    directory.mkdir()
    (directory / "seg_000.ts").write_bytes(b"segment")
    session.output_dir = directory
    threads: list[int] = []
    real_rmtree = shutil.rmtree

    def rmtree(path, *args, **kwargs):
        threads.append(threading.get_ident())
        real_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(cast.shutil, "rmtree", rmtree)
    await session.stop()
    assert not directory.exists()
    assert threads and threading.get_ident() not in threads
