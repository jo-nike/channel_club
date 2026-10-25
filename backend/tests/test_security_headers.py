"""R-01: security headers on every response, Report-Only CSP for the SPA document."""

import asyncio
from collections.abc import AsyncIterator, Mapping
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.types import Message

from app.main import app
from app.middleware.security_headers import API_CSP, SecurityHeadersMiddleware
from app.services import stream_sessions
from app.services.ersatztv.hls_rewriter import HLSManifestRewriter
from app.spa import mount_spa

SEGMENT_CSP = "default-src 'none'; sandbox"


def assert_baseline(headers: Mapping[str, str]) -> None:
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "strict-origin-when-cross-origin"


def test_api_response_gets_the_enforced_api_policy():
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert_baseline(response.headers)
    assert response.headers["content-security-policy"] == API_CSP
    assert "content-security-policy-report-only" not in response.headers


def test_body_cap_413_carries_the_headers():
    response = TestClient(app).put(
        "/api/settings",
        content=iter([b"{}"]),
        headers={"Content-Length": str(1024 * 1024), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert_baseline(response.headers)
    assert response.headers["content-security-policy"] == API_CSP


class ChunkedSegment(httpx.AsyncByteStream):
    def __init__(self, events: list[str]) -> None:
        self.events = events

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for index in range(3):
            self.events.append(f"upstream {index}")
            yield b"x" * 1024

    async def aclose(self) -> None:
        pass


@pytest.mark.asyncio
async def test_segment_proxy_keeps_its_own_csp_and_still_streams_chunk_by_chunk():
    url = "http://ersatztv.test:8409/iptv/session/8/live000010.ts"
    events: list[str] = []
    upstream = httpx.Response(
        200,
        stream=ChunkedSegment(events),
        headers={"content-type": "video/mp2t"},
        request=httpx.Request("GET", url),
    )
    start: list[Message] = []
    requests = [{"type": "http.request", "body": b"", "more_body": False}]

    async def receive() -> Message:
        if requests:
            return requests.pop()
        # No disconnect: the response finishing cancels this wait
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    async def send(message: Message) -> None:
        if message["type"] == "http.response.start":
            start.append(message)
        elif message.get("body"):
            events.append("sent")

    sid = stream_sessions.create("acct", "8").id
    path = f"/api/ersatztv/s/{sid}/segments/" + HLSManifestRewriter()._encode_url(url)
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
        "headers": [(b"host", b"testserver")],
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 80),
    }
    with (
        patch("app.routers.ersatztv.ersatztv_client", return_value=AsyncMock()),
        patch("app.routers.ersatztv.fetch_ersatztv", return_value=upstream),
    ):
        await app(scope, receive, send)

    headers = httpx.Headers([(k.decode(), v.decode()) for k, v in start[0]["headers"]])
    assert_baseline(headers)
    assert headers.get_list("content-security-policy") == [SEGMENT_CSP]
    assert headers.get_list("x-content-type-options") == ["nosniff"]
    # Each chunk goes out before the next is read from upstream: nothing is buffered
    assert events == ["upstream 0", "sent", "upstream 1", "sent", "upstream 2", "sent"]


@pytest.fixture
def spa_client(tmp_path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html><title>spa</title>")
    (static / "theme-boot.js").write_text("// boot")
    spa = FastAPI()
    mount_spa(spa, static)
    spa.add_middleware(SecurityHeadersMiddleware, stream_base_url="https://streams.example.com/x")
    return TestClient(spa, base_url="https://tv.example.com")


@pytest.mark.parametrize("path", ["/", "/watch/channel-7", "/theme-boot.js"])
def test_spa_gets_the_report_only_document_policy(spa_client, path):
    response = spa_client.get(path)
    assert response.status_code == 200
    assert_baseline(response.headers)
    assert "content-security-policy" not in response.headers
    policy = response.headers["content-security-policy-report-only"]
    directives = dict(d.split(" ", 1) for d in policy.split("; "))
    assert directives["script-src"] == "'self' https://www.gstatic.com"
    assert directives["connect-src"] == (
        "'self' wss://tv.example.com https://streams.example.com https://plex.tv"
    )
    assert directives["media-src"] == "'self' blob: https://streams.example.com https://*.giphy.com"
    assert directives["frame-ancestors"] == "'none'"
    assert directives["report-uri"] == "/api/csp-report"


def test_hostile_host_header_adds_no_socket_source(spa_client):
    response = spa_client.get("/", headers={"Host": "evil.example; script-src *"})
    policy = response.headers["content-security-policy-report-only"]
    assert "evil" not in policy
    assert "connect-src 'self' https://streams.example.com https://plex.tv" in policy


@pytest.mark.parametrize("stream_base_url", ["", "streams.example.com"])
def test_stream_base_url_without_an_origin_is_left_out(tmp_path, stream_base_url):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html><title>spa</title>")
    spa = FastAPI()
    mount_spa(spa, static)
    spa.add_middleware(SecurityHeadersMiddleware, stream_base_url=stream_base_url)
    client = TestClient(spa, base_url="https://tv.example.com")
    policy = client.get("/").headers["content-security-policy-report-only"]
    assert "://" not in policy.split()
    assert "  " not in policy
    directives = dict(d.split(" ", 1) for d in policy.split("; "))
    assert directives["media-src"] == "'self' blob: https://*.giphy.com"
    assert directives["connect-src"] == "'self' wss://tv.example.com https://plex.tv"


def test_a_callable_stream_base_url_is_read_per_request(tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html><title>spa</title>")
    spa = FastAPI()
    mount_spa(spa, static)
    current = ["https://first.example.com/x"]
    spa.add_middleware(SecurityHeadersMiddleware, stream_base_url=lambda: current[0])
    client = TestClient(spa, base_url="https://tv.example.com")

    def media_src() -> str:
        policy = client.get("/").headers["content-security-policy-report-only"]
        return dict(d.split(" ", 1) for d in policy.split("; "))["media-src"]

    assert media_src() == "'self' blob: https://first.example.com https://*.giphy.com"
    current[0] = "http://second.example.com:9191/proxy"
    assert media_src() == "'self' blob: http://second.example.com:9191 https://*.giphy.com"


def test_the_app_follows_a_dispatcharr_address_saved_while_it_runs(monkeypatch):
    """Setup step 10: an address saved in the app reaches the CSP without a restart."""
    from app.config import settings

    client = TestClient(app, base_url="https://tv.example.com")
    monkeypatch.setattr(settings, "dispatcharr_url", "https://dispatcharr.example.com:9191")
    policy = client.get("/").headers["content-security-policy-report-only"]
    directives = dict(d.split(" ", 1) for d in policy.split("; "))
    assert "https://dispatcharr.example.com:9191" in directives["media-src"].split()
    assert "https://dispatcharr.example.com:9191" in directives["connect-src"].split()
