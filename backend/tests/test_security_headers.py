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
from app.routers.auth_deps import get_current_user_or_token
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
    url = "http://192.168.50.108:8409/iptv/session/8/live000010.ts"
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

    path = "/api/ersatztv/segments/" + HLSManifestRewriter()._encode_url(url)
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
    app.dependency_overrides[get_current_user_or_token] = lambda: object()
    try:
        with (
            patch("app.routers.ersatztv.ersatztv_client", return_value=AsyncMock()),
            patch("app.routers.ersatztv.fetch_ersatztv", return_value=upstream),
        ):
            await app(scope, receive, send)
    finally:
        app.dependency_overrides.pop(get_current_user_or_token, None)

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
