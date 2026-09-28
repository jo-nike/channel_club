"""CastService lifecycle: the idle sweep, startup cleanup and following Live."""

import asyncio
import os
import shutil
import subprocess
from collections.abc import Iterator
from contextlib import suppress
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.config import settings
from app.models.channel import Channel
from app.services import cast, channel_state
from app.services.cast import CastService, CastSession
from app.services.media_limits import process_budget


class FakeProcess:
    """A Popen stand-in that is running until it is given an exit code."""

    pid = 4242

    def __init__(self) -> None:
        self.returncode: int | None = None

    def poll(self) -> int | None:
        return self.returncode


def add_session(service: CastService, session_id: str, *, alive: bool, idle: float) -> CastSession:
    """Register a transcoding session idle for `idle` seconds, owned by its id."""
    session = CastSession(session_id, "7", "http://fixture", "mpegts")
    process = FakeProcess()
    if not alive:
        process.returncode = 1
    session.process = process  # type: ignore[assignment]
    session.last_activity = cast.monotonic() - idle
    process_budget.acquire(session_id)
    service._sessions[session_id] = session
    service._owners[session_id] = session_id
    return session


class TestIdleSweep:
    """The sweep retires dead and unwatched casts and nothing else (E-09)."""

    async def test_removes_dead_and_idle_sessions_and_keeps_an_active_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "cast_session_timeout", 300)
        service = CastService()
        add_session(service, "dead", alive=False, idle=1)
        add_session(service, "idle", alive=True, idle=301)
        add_session(service, "active", alive=True, idle=1)

        with patch.object(CastSession, "stop", AsyncMock()):
            await service._cleanup_idle_sessions()

        assert list(service._sessions) == ["active"]
        assert process_budget.owners == {"active": 1}


def test_startup_removes_stale_session_directories_without_a_process_scan(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A restart has a fresh PID namespace: only the files are left over (G-10)."""
    monkeypatch.setattr(settings, "cast_temp_dir", str(tmp_path))
    (tmp_path / "old-session").mkdir()
    (tmp_path / "old-session" / "seg_001.ts").write_bytes(b"\x47")

    with patch("subprocess.run") as run:
        CastService().cleanup_stale_sessions()

    assert not list(tmp_path.iterdir())
    run.assert_not_called()


def live(channel_id: str) -> Channel:
    return Channel(
        id=channel_id,
        name=f"Channel {channel_id}",
        stream_url=f"http://source/{channel_id}",
        guide_id=channel_id,
    )


class FakeFFmpeg:
    """Popen stand-in: writes the playlist as FFmpeg would (a new file), or exits at once."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.sources: list[str] = []
        self.processes: list[FakeProcess] = []

    def __call__(self, command: list[str], **_kwargs: object) -> FakeProcess:
        process = FakeProcess()
        self.sources.append(command[command.index("-i") + 1])
        self.processes.append(process)
        if self.fail:
            process.returncode = 1
        else:
            playlist = Path(command[-1])
            fresh = playlist.with_suffix(".tmp")
            fresh.write_text(f"#EXTM3U\n# writer {len(self.processes)}\n")
            os.replace(fresh, playlist)
        return process


def terminate(process: FakeProcess) -> None:
    process.returncode = -15


def add_follower(
    service: CastService, tmp_path: Path, session_id: str, owner: str, *, follows_live: bool = True
) -> tuple[CastSession, FakeProcess]:
    """Register a running transcode of channel A, holding one of owner's slots."""
    session = CastSession(session_id, "A", "http://source/A", "mpegts", follows_live)
    session.output_dir = tmp_path / session_id
    session.output_dir.mkdir()
    (session.output_dir / "playlist.m3u8").write_text("#EXTM3U\n")
    process = FakeProcess()
    session.process = process  # type: ignore[assignment]
    session.last_activity = cast.monotonic()
    process_budget.acquire(owner)
    service._sessions[session_id] = session
    service._owners[session_id] = owner
    return session, process


@pytest.fixture
def ffmpeg() -> Iterator[FakeFFmpeg]:
    fake = FakeFFmpeg()
    with (
        patch("subprocess.Popen", fake),
        patch.object(CastSession, "_terminate_process", staticmethod(terminate)),
    ):
        yield fake


class TestFollowLive:
    """A cast of the Live slot follows Live, and stops with it (K-02)."""

    async def test_moves_to_the_new_channel_in_the_same_session_and_slot(
        self, tmp_path: Path, ffmpeg: FakeFFmpeg
    ) -> None:
        service = CastService()
        session, old = add_follower(service, tmp_path, "follower-1", "alice")
        directory = session.output_dir

        await service.follow_live(live("B"))

        assert service.get_session("follower-1") is session
        assert session.output_dir == directory
        assert (session.channel_id, session.stream_url) == ("B", "http://source/B")
        assert old.returncode == -15
        assert ffmpeg.sources == ["http://source/B"]
        assert session.is_running
        assert process_budget.owners == {"alice": 1}

    async def test_a_cast_that_does_not_follow_stays(
        self, tmp_path: Path, ffmpeg: FakeFFmpeg
    ) -> None:
        service = CastService()
        session, _ = add_follower(service, tmp_path, "pinned-1", "bob", follows_live=False)

        await service.follow_live(live("B"))
        await service.follow_live(None)

        assert session.channel_id == "A"
        assert service.get_session("pinned-1") is session
        assert not ffmpeg.sources

    async def test_a_failed_switch_stops_the_session(
        self, tmp_path: Path, ffmpeg: FakeFFmpeg
    ) -> None:
        ffmpeg.fail = True
        service = CastService()
        add_follower(service, tmp_path, "follower-1", "alice")

        await service.follow_live(live("B"))

        assert service.get_session("follower-1") is None
        assert not process_budget.owners

    async def test_the_idle_sweep_leaves_a_session_mid_switch(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "cast_session_timeout", 300)
        service = CastService()
        session, process = add_follower(service, tmp_path, "follower-1", "alice")
        # Between the old FFmpeg's exit and the new one's start
        process.returncode = -15
        session.last_activity = cast.monotonic() - 301

        async with session._lock:
            await service._cleanup_idle_sessions()

        assert service.get_session("follower-1") is session
        assert process_budget.owners == {"alice": 1}


@pytest.fixture
def cast_on(monkeypatch: pytest.MonkeyPatch) -> Iterator[CastService]:
    """Casting on, highlights off, a fresh cast service behind channel_state."""
    service = CastService()
    monkeypatch.setattr(settings, "cast_enabled", True)
    monkeypatch.setattr(settings, "highlight_enabled", False)
    monkeypatch.setattr("app.services.cast.cast_service", service)
    yield service


async def drain_reconcile() -> None:
    task = channel_state._reconcile_task
    if task is not None:
        await task


class TestLiveChanges:
    """channel_state moves follow-live casts on a Live change (K-02)."""

    async def test_quick_changes_leave_the_cast_on_the_latest_channel(
        self, tmp_path: Path, ffmpeg: FakeFFmpeg, cast_on: CastService
    ) -> None:
        session, _ = add_follower(cast_on, tmp_path, "follower-1", "alice")

        await channel_state.set_current_channel(live("B"))
        await channel_state.set_current_channel(live("C"))
        await drain_reconcile()

        assert session.channel_id == "C"
        assert session.is_running
        assert process_budget.owners == {"alice": 1}

    async def test_stopping_live_stops_follow_live_casts_only(
        self, tmp_path: Path, ffmpeg: FakeFFmpeg, cast_on: CastService
    ) -> None:
        add_follower(cast_on, tmp_path, "follower-1", "alice")
        pinned, _ = add_follower(cast_on, tmp_path, "pinned-1", "bob", follows_live=False)

        await channel_state.clear_current_channel_async(user="carol")
        await drain_reconcile()

        assert list(cast_on._sessions.values()) == [pinned]
        assert process_budget.owners == {"bob": 1}

    async def test_a_failing_follow_does_not_stop_the_recorder_start(
        self, cast_on: CastService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "highlight_enabled", True)
        recorder = AsyncMock()
        with (
            patch.object(cast_on, "follow_live", AsyncMock(side_effect=RuntimeError("boom"))),
            patch("app.services.highlight.highlight_service", recorder),
        ):
            result = await channel_state.set_current_channel(live("B"))
            await drain_reconcile()

        assert result.id == "B"
        recorder.start_recording.assert_awaited_once()


def playlist_samples(playlist: Path, stop: asyncio.Event) -> "asyncio.Task[list[str]]":
    """Read the playlist every 20 ms until told to stop."""

    async def sample() -> list[str]:
        seen: list[str] = []
        while not stop.is_set():
            with suppress(FileNotFoundError):
                seen.append(playlist.read_text())
            await asyncio.sleep(0.02)
        return seen

    return asyncio.create_task(sample())


def make_clip(path: Path, seconds: int) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x90:rate=25",
            "-f",
            "lavfi",
            "-i",
            "sine",
            "-t",
            str(seconds),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-g",
            "25",
            "-c:a",
            "aac",
            "-f",
            "mpegts",
            str(path),
        ],
        check=True,
    )


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
async def test_a_real_switch_keeps_one_growing_playlist(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The receiver sees one live playlist: a discontinuity, no end, nothing reused."""
    for name in ("a", "b"):
        make_clip(tmp_path / f"{name}.ts", 12)
    monkeypatch.setattr(cast, "ffmpeg_input_args", lambda source: ["-re", "-i", source])
    monkeypatch.setattr(settings, "cast_temp_dir", str(tmp_path / "cast"))
    monkeypatch.setattr(settings, "cast_hls_segment_time", 1)
    monkeypatch.setattr(settings, "cast_hls_list_size", 3)
    session = CastSession("real-switch", "a", str(tmp_path / "a.ts"), "mpegts", True)
    try:
        assert await session.start()
        assert session.playlist_path is not None
        stop = asyncio.Event()
        sampling = playlist_samples(session.playlist_path, stop)
        await asyncio.sleep(2.5)
        assert await session.switch_source("b", str(tmp_path / "b.ts"))
        await asyncio.sleep(2.5)
        stop.set()
        samples = await sampling
    finally:
        await session.stop()

    assert any("#EXT-X-DISCONTINUITY" in text for text in samples)
    assert not any("#EXT-X-ENDLIST" in text for text in samples)
    sequences = [
        int(line.split(":")[1])
        for text in samples
        for line in text.splitlines()
        if line.startswith("#EXT-X-MEDIA-SEQUENCE:")
    ]
    assert sequences == sorted(sequences)
    # Each media sequence number names one segment, and a name never comes back
    named: dict[int, str] = {}
    for text in samples:
        lines = text.splitlines()
        first = next(int(x.split(":")[1]) for x in lines if x.startswith("#EXT-X-MEDIA-SEQUENCE:"))
        segments = [line for line in lines if line.endswith(".ts")]
        for offset, segment in enumerate(segments):
            assert named.setdefault(first + offset, segment) == segment
    assert len(set(named.values())) == len(named)
