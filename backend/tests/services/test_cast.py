"""CastService lifecycle: the idle sweep and startup cleanup."""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.config import settings
from app.services import cast
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
