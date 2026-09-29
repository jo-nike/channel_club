"""ErsatzTV stream sessions (H-01) and the stream routes' shared behaviour (C-11)."""

import re
from collections.abc import Callable, Iterator, MutableMapping
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.models.ersatztv import EPGChannel
from app.services import stream_sessions
from app.services.auth import create_access_token
from app.services.ersatztv.hls_rewriter import HLSManifestRewriter, decode_url
from app.services.ersatztv.refresh import FeedUnavailableError
from app.services.http_clients import ERSATZTV
from tests.http_helpers import mock_upstream

UPSTREAM = settings.ersatztv_base_url.rstrip("/")
JWT_SHAPE = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")

MASTER = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\n/iptv/session/8/hls.m3u8\n"
MEDIA = (
    "#EXTM3U\n#EXT-X-TARGETDURATION:4\n"
    '#EXT-X-MAP:URI="init.mp4"\n'
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n'
    "#EXTINF:4,\nlive000010.ts\n"
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
    token = create_access_token({"sub": "viewer", "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def channel() -> EPGChannel:
    return EPGChannel(
        id="8",
        name="Eight",
        stream_url=f"{UPSTREAM}/iptv/channel/8.m3u8",
        number=8,
    )


@pytest.fixture
def lookup(channel: EPGChannel) -> Iterator[None]:
    with patch("app.routers.ersatztv.get_channel_by_id", return_value=channel):
        yield


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """The session registry's clock, moved by assigning now[0]."""
    now = [1000.0]
    monkeypatch.setattr(stream_sessions, "monotonic", lambda: now[0])
    return now


@contextmanager
def _patched_upstream(handler: Callable[[httpx.Request], httpx.Response]) -> Iterator[None]:
    mock_upstream(ERSATZTV, handler)
    yield


def _ersatztv(requests: list[httpx.Request]) -> Callable[[httpx.Request], httpx.Response]:
    """ErsatzTV's real shapes: channel playlist, session variant, segment."""

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        playlist = {"content-type": "application/vnd.apple.mpegurl"}
        if request.url.path == "/iptv/channel/8.m3u8":
            return httpx.Response(200, text=MASTER, headers=playlist)
        if request.url.path == "/iptv/session/8/hls.m3u8":
            return httpx.Response(200, text=MEDIA, headers=playlist)
        if request.url.path.startswith("/iptv/session/8/"):
            return httpx.Response(200, content=b"media", headers={"content-type": "video/mp2t"})
        return httpx.Response(404)

    return handler


def _uris(manifest: str) -> list[str]:
    """Every URI in a manifest: bare lines and URI= attributes."""
    uris = re.findall(r'URI="([^"]*)"', manifest)
    uris += [line for line in manifest.splitlines() if line and not line.startswith("#")]
    return uris


def _open(client: TestClient, headers: dict[str, str], channel_id: str = "8") -> dict[str, str]:
    response = client.post("/api/ersatztv/session", json={"channelId": channel_id}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _encode(url: str) -> str:
    return HLSManifestRewriter()._encode_url(url)


class TestCreateSession:
    def test_requires_the_authorization_header(self, client: TestClient, lookup: None) -> None:
        token = create_access_token({"sub": "viewer", "role": "viewer"})
        assert client.post("/api/ersatztv/session", json={"channelId": "8"}).status_code == 401
        response = client.post(f"/api/ersatztv/session?token={token}", json={"channelId": "8"})
        assert response.status_code == 401

    def test_unknown_channel_is_404(self, client: TestClient, auth_header: dict[str, str]) -> None:
        with patch("app.routers.ersatztv.get_channel_by_id", return_value=None):
            response = client.post(
                "/api/ersatztv/session", json={"channelId": "nope"}, headers=auth_header
            )
        assert response.status_code == 404
        assert response.json()["detail"] == "Channel not found"

    def test_feed_down_is_503(self, client: TestClient, auth_header: dict[str, str]) -> None:
        with patch(
            "app.routers.ersatztv.get_channel_by_id", side_effect=FeedUnavailableError("down")
        ):
            response = client.post(
                "/api/ersatztv/session", json={"channelId": "8"}, headers=auth_header
            )
        assert response.status_code == 503
        assert response.json()["detail"] == "ErsatzTV service unavailable"

    def test_returns_a_token_free_session_url(
        self, client: TestClient, auth_header: dict[str, str], lookup: None
    ) -> None:
        body = _open(client, auth_header)
        assert body["url"] == f"/api/ersatztv/s/{body['sessionId']}/stream.m3u8"
        assert "token" not in body["url"]
        assert "eyJ" not in body["url"]
        session = stream_sessions.get(body["sessionId"])
        assert session is not None
        assert session.account == "local:viewer"
        assert session.channel_id == "8"

    def test_global_cap_is_429(
        self, client: TestClient, auth_header: dict[str, str], lookup: None
    ) -> None:
        with patch.object(stream_sessions, "STREAM_SESSIONS_MAX", 1):
            _open(client, auth_header)
            other = create_access_token({"sub": "other", "role": "viewer"})
            response = client.post(
                "/api/ersatztv/session",
                json={"channelId": "8"},
                headers={"Authorization": f"Bearer {other}"},
            )
        assert response.status_code == 429
        assert response.json()["detail"] == "Too many open streams"

    def test_per_account_cap_evicts_only_that_accounts_oldest(
        self, client: TestClient, auth_header: dict[str, str], lookup: None, clock: list[float]
    ) -> None:
        other = create_access_token({"sub": "other", "role": "viewer"})
        theirs = _open(client, {"Authorization": f"Bearer {other}"})["sessionId"]
        mine = []
        for _ in range(stream_sessions.STREAM_SESSIONS_PER_ACCOUNT + 1):
            clock[0] += 1
            mine.append(_open(client, auth_header)["sessionId"])
        assert stream_sessions.get(mine[0]) is None
        assert all(stream_sessions.get(sid) is not None for sid in mine[1:])
        assert stream_sessions.get(theirs) is not None


class TestSessionPlayback:
    def test_manifests_carry_no_credential_and_reach_the_right_upstream(
        self, client: TestClient, auth_header: dict[str, str], lookup: None
    ) -> None:
        body = _open(client, auth_header)
        sid = body["sessionId"]
        requests: list[httpx.Request] = []
        with _patched_upstream(_ersatztv(requests)):
            master = client.get(body["url"])
            assert master.status_code == 200
            assert master.headers["access-control-allow-origin"] == "*"
            assert master.headers["x-content-type-options"] == "nosniff"
            assert master.headers["content-security-policy"] == "default-src 'none'; sandbox"
            [variant] = _uris(master.text)
            media = client.get(variant)
            assert media.status_code == 200
            uris = _uris(media.text)
            fetched = [client.get(uri) for uri in uris]

        manifests = master.text + media.text
        assert "token" not in manifests
        assert "eyJ" not in manifests
        assert not JWT_SHAPE.search(manifests)
        for uri in [variant, *uris]:
            assert uri.startswith(f"/api/ersatztv/s/{sid}/")
        assert urlsplit(variant).path == f"/api/ersatztv/s/{sid}/stream.m3u8"
        assert decode_url(parse_qs(urlsplit(variant).query)["url"][0]) == (
            f"{UPSTREAM}/iptv/session/8/hls.m3u8"
        )
        assert all(r.status_code == 200 and r.content == b"media" for r in fetched)
        assert [str(r.url) for r in requests] == [
            f"{UPSTREAM}/iptv/channel/8.m3u8",
            f"{UPSTREAM}/iptv/session/8/hls.m3u8",
            f"{UPSTREAM}/iptv/session/8/init.mp4",
            f"{UPSTREAM}/iptv/session/8/key.bin",
            f"{UPSTREAM}/iptv/session/8/live000010.ts",
        ]
        assert all("authorization" not in r.headers for r in requests)

    def test_session_routes_need_no_authorization_header(
        self, client: TestClient, auth_header: dict[str, str], lookup: None
    ) -> None:
        """The client that plays the URL (hls.js, a Chromecast) sends no header."""
        sid = _open(client, auth_header)["sessionId"]
        segment = _encode(f"{UPSTREAM}/iptv/session/8/live000010.ts")
        with _patched_upstream(_ersatztv([])):
            assert client.head(f"/api/ersatztv/s/{sid}/stream.m3u8").status_code == 200
            assert client.head(f"/api/ersatztv/s/{sid}/segments/{segment}").status_code == 200
            assert client.get(f"/api/ersatztv/s/{sid}/segments/{segment}").status_code == 200

    @pytest.mark.parametrize("kind", ["unknown", "short", "expired"])
    @pytest.mark.parametrize("route", ["stream", "segment", "head-stream", "head-segment"])
    def test_missing_session_is_404_before_any_upstream_request(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        lookup: None,
        clock: list[float],
        kind: str,
        route: str,
    ) -> None:
        sid = _open(client, auth_header)["sessionId"]
        if kind == "unknown":
            sid = "A" * 32
        elif kind == "short":
            sid = sid[:31]
        else:
            clock[0] += stream_sessions.STREAM_SESSION_IDLE_SECONDS
        segment = _encode(f"{UPSTREAM}/iptv/session/8/live000010.ts")
        path = {
            "stream": f"/api/ersatztv/s/{sid}/stream.m3u8",
            "head-stream": f"/api/ersatztv/s/{sid}/stream.m3u8",
            "segment": f"/api/ersatztv/s/{sid}/segments/{segment}",
            "head-segment": f"/api/ersatztv/s/{sid}/segments/{segment}",
        }[route]
        requests: list[httpx.Request] = []
        with _patched_upstream(_ersatztv(requests)):
            response = client.head(path) if route.startswith("head") else client.get(path)
        assert response.status_code == 404
        if not route.startswith("head"):
            assert response.json()["detail"] == "Stream session not found"
        assert requests == []

    @pytest.mark.parametrize("route", ["stream", "segment", "head-stream", "head-segment"])
    def test_use_keeps_a_session_alive(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        lookup: None,
        clock: list[float],
        route: str,
    ) -> None:
        sid = _open(client, auth_header)["sessionId"]
        segment = _encode(f"{UPSTREAM}/iptv/session/8/live000010.ts")
        path = (
            f"/api/ersatztv/s/{sid}/stream.m3u8"
            if route.endswith("stream")
            else f"/api/ersatztv/s/{sid}/segments/{segment}"
        )
        with _patched_upstream(_ersatztv([])):
            for _ in range(3):  # 600 s in all, never 300 s idle
                clock[0] += 200
                response = client.head(path) if route.startswith("head") else client.get(path)
                assert response.status_code == 200

    @pytest.mark.parametrize(
        "path",
        [
            "stream.m3u8?url={}".format(_encode(f"{UPSTREAM}/api/channels")),
            "stream.m3u8?url={}".format(_encode("http://evil.example.com/iptv/channel/8.m3u8")),
            "segments/{}".format(_encode(f"{UPSTREAM}/iptv/channel/8.m3u8")),
            "segments/{}".format(_encode(f"{UPSTREAM}/api/channels")),
        ],
    )
    def test_disallowed_url_is_400_before_any_upstream_request(
        self, client: TestClient, auth_header: dict[str, str], lookup: None, path: str
    ) -> None:
        sid = _open(client, auth_header)["sessionId"]
        requests: list[httpx.Request] = []
        with _patched_upstream(_ersatztv(requests)):
            response = client.get(f"/api/ersatztv/s/{sid}/{path}")
        assert response.status_code == 400
        assert requests == []

    @pytest.mark.parametrize("kind", ["stream", "segment"])
    def test_off_host_redirect_is_502(
        self, client: TestClient, auth_header: dict[str, str], lookup: None, kind: str
    ) -> None:
        sid = _open(client, auth_header)["sessionId"]
        requests: list[httpx.Request] = []

        def upstream(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(302, headers={"location": "http://169.254.169.254/x.m3u8"})

        path = (
            f"/api/ersatztv/s/{sid}/stream.m3u8"
            if kind == "stream"
            else f"/api/ersatztv/s/{sid}/segments/"
            + _encode(f"{UPSTREAM}/iptv/session/8/live000010.ts")
        )
        with _patched_upstream(upstream):
            response = client.get(path)
        assert response.status_code == 502
        assert all(r.url.host != "169.254.169.254" for r in requests)

    def test_oversized_segment_is_502(
        self, client: TestClient, auth_header: dict[str, str], lookup: None
    ) -> None:
        sid = _open(client, auth_header)["sessionId"]

        def upstream(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"x" * 10, headers={"content-type": "video/mp2t"})

        segment = _encode(f"{UPSTREAM}/iptv/session/8/live000010.ts")
        with (
            _patched_upstream(upstream),
            patch("app.routers.ersatztv.MAX_SEGMENT_BYTES", 4),
        ):
            response = client.get(f"/api/ersatztv/s/{sid}/segments/{segment}")
        assert response.status_code == 502
        assert response.json()["detail"] == "Segment too large"


class TestClientDisconnectStopsStartupRetries:
    """C-11: a cold-start loop stops once the client has gone."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("route", ["legacy", "session"])
    async def test_disconnect_stops_retrying(self, channel: EPGChannel, route: str) -> None:
        calls: list[httpx.Request] = []

        def upstream(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return httpx.Response(404, text="not yet")  # a cold start

        headers = [(b"host", b"test")]
        if route == "legacy":
            token = create_access_token({"sub": "viewer", "role": "viewer"})
            headers.append((b"authorization", f"Bearer {token}".encode()))
            path = "/api/ersatztv/stream/8"
        else:
            path = stream_sessions.manifest_path(stream_sessions.create("local:viewer", "8").id)

        messages: list[dict[str, Any]] = [
            {"type": "http.request", "body": b"", "more_body": False},
            {"type": "http.disconnect"},
        ]

        async def receive() -> dict[str, Any]:
            return messages.pop(0) if messages else {"type": "http.disconnect"}

        sent: list[MutableMapping[str, Any]] = []

        async def send(message: MutableMapping[str, Any]) -> None:
            sent.append(message)

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "root_path": "",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 1234),
            "server": ("test", 80),
        }
        with (
            patch("app.routers.ersatztv.get_channel_by_id", return_value=channel),
            _patched_upstream(upstream),
            patch("app.routers.ersatztv.asyncio.sleep", AsyncMock()) as sleep,
        ):
            await app(scope, receive, send)

        assert len(calls) == 1
        sleep.assert_not_awaited()
        assert sent[0]["type"] == "http.response.start"
        assert sent[0]["status"] == 499
