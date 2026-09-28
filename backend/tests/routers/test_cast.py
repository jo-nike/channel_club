"""The cast routes: HLS file serving, session create and delete."""

from collections.abc import Iterator
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.models.channel import Channel
from app.services.auth import create_access_token
from app.services.cast import CastService, CastSession
from app.services.media_limits import process_budget
from app.services.media_source import MediaChannel

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


def bearer(sub: str, plex_id: str | None = None) -> dict[str, str]:
    claims = {"sub": sub, "role": "viewer"}
    if plex_id is not None:
        claims["plex_id"] = plex_id
    return {"Authorization": f"Bearer {create_access_token(claims)}"}


def source(stream_type: str) -> MediaChannel:
    channel = Channel(id="7", name="Seven", stream_url="http://source/7", guide_id="7")
    return MediaChannel(channel, stream_type)


@pytest.fixture
def mpegts(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Casting on, channel 7 a Dispatcharr channel, FFmpeg stubbed."""
    monkeypatch.setattr(settings, "cast_enabled", True)
    with (
        patch("app.routers.cast.resolve_media_channel", AsyncMock(return_value=source("mpegts"))),
        patch.object(CastSession, "start", AsyncMock(return_value="/fixture")),
        patch.object(CastSession, "stop", AsyncMock()),
    ):
        yield


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


@pytest.mark.usefixtures("mpegts")
class TestStopOwnership:
    """Only the account that started a cast can stop it (E-15)."""

    def create(self, client: TestClient, headers: dict[str, str]) -> str:
        response = client.post(
            "/api/cast/session", json={"channel_id": "7", "stream_type": "mpegts"}, headers=headers
        )
        assert response.status_code == 200
        return response.json()["session_id"]

    def test_someone_else_cannot_stop_a_cast(self, client: TestClient, service: CastService) -> None:
        session_id = self.create(client, bearer("alice"))

        response = client.delete(f"/api/cast/session/{session_id}", headers=bearer("bob"))

        assert response.json() == {"stopped": False}
        assert service.get_session(session_id) is not None
        assert process_budget.owners == {"local:alice": 1}

    def test_the_owner_stops_it(self, client: TestClient, service: CastService) -> None:
        session_id = self.create(client, bearer("alice"))

        response = client.delete(f"/api/cast/session/{session_id}", headers=bearer("alice"))

        assert response.json() == {"stopped": True}
        assert service.get_session(session_id) is None
        assert not process_budget.owners

    def test_a_plex_account_with_a_local_accounts_name_is_someone_else(
        self, client: TestClient, service: CastService
    ) -> None:
        session_id = self.create(client, bearer("viewer"))

        response = client.delete(f"/api/cast/session/{session_id}", headers=bearer("viewer", "1"))

        assert response.json() == {"stopped": False}
        assert service.get_session(session_id) is not None

    def test_an_unknown_id_answers_the_same(self, client: TestClient) -> None:
        response = client.delete("/api/cast/session/nope", headers=bearer("alice"))

        assert response.json() == {"stopped": False}
