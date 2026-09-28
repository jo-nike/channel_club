"""The cast routes: HLS file serving, session create and delete."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.cast import CastService, CastSession

SESSION_ID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> Iterator[CastService]:
    """A fresh cast service behind the router, so no test sees another's sessions."""
    fresh = CastService()
    monkeypatch.setattr("app.routers.cast.cast_service", fresh)
    monkeypatch.setattr("app.services.cast.cast_service", fresh)
    yield fresh


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def live_session(service: CastService, tmp_path: Path) -> CastSession:
    """A session whose FFmpeg has written a playlist and two segments."""
    session = CastSession(SESSION_ID, "7", "http://fixture", "mpegts")
    session.output_dir = tmp_path / SESSION_ID
    session.output_dir.mkdir()
    (session.output_dir / "playlist.m3u8").write_text("#EXTM3U\n")
    (session.output_dir / "seg_001.ts").write_bytes(b"\x47" * 188)
    (session.output_dir / "seg_1000.ts").write_bytes(b"\x47" * 188)
    service._sessions[SESSION_ID] = session
    return session


class TestHlsFileNames:
    """Only the names FFmpeg writes are served; nothing else answers 500 (M-05)."""

    @pytest.mark.parametrize("name", ["%2E%2E", "%2E", "x.txt", "seg_1.ts", "playlist.m3u8.bak"])
    def test_other_names_are_refused_without_a_500(
        self, client: TestClient, live_session: CastSession, name: str
    ) -> None:
        response = client.get(f"/api/cast/hls/{SESSION_ID}/{name}")

        assert response.status_code in (404, 422)

    def test_a_segment_past_999_serves(self, client: TestClient, live_session: CastSession) -> None:
        response = client.get(f"/api/cast/hls/{SESSION_ID}/seg_1000.ts")

        assert response.status_code == 200

    def test_the_not_found_detail_does_not_echo_the_name(
        self, client: TestClient, live_session: CastSession
    ) -> None:
        response = client.get(f"/api/cast/hls/{SESSION_ID}/seg_002.ts")

        assert response.status_code == 404
        assert response.json() == {"detail": "File not found"}

    def test_the_session_directory_is_not_a_file(self, live_session: CastSession) -> None:
        assert live_session.get_file_path("..") is None
        assert live_session.get_file_path(".") is None
