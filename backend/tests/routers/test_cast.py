"""The cast routes: HLS file serving, session create and delete."""

from collections.abc import Iterator
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.channel import Channel
from app.services import channel_state, stream_sessions
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
    """Channel 7 a Dispatcharr channel, FFmpeg stubbed."""
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

    def test_someone_else_cannot_stop_a_cast(
        self, client: TestClient, service: CastService
    ) -> None:
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


class TestHlsFiles:
    """What the Chromecast fetches (E-09)."""

    def test_an_unknown_session_is_404(self, client: TestClient, service: CastService) -> None:
        response = client.get(f"/api/cast/hls/{SESSION_ID}/playlist.m3u8")

        assert response.status_code == 404

    @pytest.mark.parametrize(
        ("name", "media_type"),
        [("playlist.m3u8", "application/vnd.apple.mpegurl"), ("seg_001.ts", "video/mp2t")],
    )
    def test_a_live_session_serves_its_files(
        self, client: TestClient, live_session: CastSession, name: str, media_type: str
    ) -> None:
        response = client.get(f"/api/cast/hls/{SESSION_ID}/{name}")

        assert response.status_code == 200
        assert response.headers["content-type"] == media_type
        assert "no-store" in response.headers["cache-control"]
        assert response.headers["access-control-allow-origin"] == "*"


class TestCreate:
    """POST /api/cast/session (E-09)."""

    @pytest.mark.usefixtures("mpegts")
    def test_a_dispatcharr_channel_is_transcoded(
        self, client: TestClient, service: CastService
    ) -> None:
        response = client.post(
            "/api/cast/session",
            json={"channel_id": "7", "stream_type": "mpegts"},
            headers=bearer("alice"),
        )

        assert response.status_code == 200
        assert response.json()["needs_transcoding"] is True
        assert process_budget.owners == {"local:alice": 1}

    @pytest.mark.usefixtures("mpegts")
    def test_a_failed_start_is_500_and_releases_the_slot(
        self, client: TestClient, service: CastService
    ) -> None:
        with patch.object(CastSession, "start", AsyncMock(return_value=None)):
            response = client.post(
                "/api/cast/session",
                json={"channel_id": "7", "stream_type": "mpegts"},
                headers=bearer("alice"),
            )

        assert response.status_code == 500
        assert not process_budget.owners
        assert not service._sessions

    def test_an_ersatztv_channel_gets_a_stream_session_and_no_slot(
        self, client: TestClient, service: CastService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        spawn = MagicMock()
        with (
            patch("app.routers.cast.resolve_media_channel", AsyncMock(return_value=source("hls"))),
            patch("subprocess.Popen", spawn),
        ):
            # The server's resolved type wins over what the client says
            response = client.post(
                "/api/cast/session",
                json={"channel_id": "7", "stream_type": "mpegts"},
                headers=bearer("alice"),
            )

        assert response.status_code == 200
        body = response.json()
        assert body["needs_transcoding"] is False
        assert body["hls_url"] == stream_sessions.manifest_path(body["session_id"])
        stream = stream_sessions.get(body["session_id"])
        assert stream is not None
        assert (stream.account, stream.channel_id) == ("local:alice", "7")
        assert not process_budget.owners
        assert not service._sessions
        spawn.assert_not_called()
        # Nothing to stop: the stream session ends by idle expiry
        stop = client.delete(f"/api/cast/session/{body['session_id']}", headers=bearer("alice"))
        assert stop.json() == {"stopped": False}

    def test_no_stream_session_left_is_429(
        self, client: TestClient, service: CastService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with (
            patch("app.routers.cast.resolve_media_channel", AsyncMock(return_value=source("hls"))),
            patch(
                "app.services.stream_sessions.create",
                side_effect=stream_sessions.StreamSessionLimitError("full"),
            ),
        ):
            response = client.post(
                "/api/cast/session",
                json={"channel_id": "7", "stream_type": "hls"},
                headers=bearer("alice"),
            )

        assert response.status_code == 429


@pytest.mark.usefixtures("mpegts")
class TestFollowsLive:
    """Only a cast of the channel that is Live now follows Live (K-02)."""

    @pytest.mark.parametrize(("live_id", "follows"), [("7", True), ("9", False), (None, False)])
    def test_follows_live_only_for_the_live_channel(
        self, client: TestClient, service: CastService, live_id: str | None, follows: bool
    ) -> None:
        if live_id is not None:
            channel_state._current_channel = Channel(
                id=live_id, name="Live", stream_url=f"http://source/{live_id}", guide_id=live_id
            )

        response = client.post(
            "/api/cast/session",
            json={"channel_id": "7", "stream_type": "mpegts", "follows_live": True},
            headers=bearer("alice"),
        )

        session = service.get_session(response.json()["session_id"])
        assert session is not None
        assert session.follows_live is follows

    def test_an_old_client_never_follows(self, client: TestClient, service: CastService) -> None:
        channel_state._current_channel = Channel(
            id="7", name="Live", stream_url="http://source/7", guide_id="7"
        )

        response = client.post(
            "/api/cast/session",
            json={"channel_id": "7", "stream_type": "mpegts"},
            headers=bearer("alice"),
        )

        session = service.get_session(response.json()["session_id"])
        assert session is not None
        assert session.follows_live is False
