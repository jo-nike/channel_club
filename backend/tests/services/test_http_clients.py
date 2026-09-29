"""One long-lived client per upstream, closed by the lifespan (C-02)."""

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.types import Message

from app.config import settings
from app.main import app
from app.routers.auth_deps import get_current_user_or_token
from app.services import http_clients
from app.services.ersatztv.hls_rewriter import HLSManifestRewriter
from app.services.http_clients import (
    DISPATCHARR,
    ERSATZTV,
    aclose_http_clients,
    dispatcharr_client,
    ersatztv_client,
)
from app.services.status_service import get_dispatcharr_status
from app.services.tls import SSL_CONTEXT
from tests.http_helpers import mock_upstream

UPSTREAM = settings.ersatztv_base_url.rstrip("/")


def _segment_path(name: str) -> str:
    url = f"{UPSTREAM}/iptv/session/8/{name}"
    return "/api/ersatztv/segments/" + HLSManifestRewriter()._encode_url(url)


def _count_constructions(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Record the keyword arguments of every httpx.AsyncClient built from now on."""
    constructed: list[dict[str, Any]] = []
    real_init = httpx.AsyncClient.__init__

    def counting_init(self: httpx.AsyncClient, *args: Any, **kwargs: Any) -> None:
        constructed.append(kwargs)
        real_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", counting_init)
    return constructed


@pytest.fixture
async def downstream() -> AsyncIterator[httpx.AsyncClient]:
    """An ASGI client for the app, with the stream routes' auth satisfied."""
    app.dependency_overrides[get_current_user_or_token] = lambda: object()
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test")
    try:
        yield client
    finally:
        await client.aclose()
        app.dependency_overrides.pop(get_current_user_or_token, None)


async def test_each_upstream_gets_one_lazily_built_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    constructed = _count_constructions(monkeypatch)

    ersatztv = ersatztv_client()
    dispatcharr = dispatcharr_client()

    assert ersatztv_client() is ersatztv
    assert dispatcharr_client() is dispatcharr
    assert len(constructed) == 2
    ersatztv_kwargs, dispatcharr_kwargs = constructed
    assert ersatztv_kwargs["follow_redirects"] is False
    assert ersatztv_kwargs["limits"] == httpx.Limits(
        max_connections=50, max_keepalive_connections=20
    )
    assert ersatztv_kwargs["verify"] is SSL_CONTEXT
    assert dispatcharr_kwargs["follow_redirects"] is False
    assert dispatcharr_kwargs["verify"] is SSL_CONTEXT
    # The API key goes on each request, never on the client
    assert "authorization" not in dispatcharr.headers
    await aclose_http_clients()


async def test_five_segments_build_no_client_and_share_one(
    monkeypatch: pytest.MonkeyPatch, downstream: httpx.AsyncClient
) -> None:
    requests: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, content=b"media", headers={"content-type": "video/mp2t"})

    shared = mock_upstream(ERSATZTV, upstream)
    constructed = _count_constructions(monkeypatch)

    responses = [await downstream.get(_segment_path(f"live00001{index}.ts")) for index in range(5)]

    assert [r.status_code for r in responses] == [200] * 5
    assert [r.content for r in responses] == [b"media"] * 5
    assert constructed == []
    assert len(requests) == 5
    assert ersatztv_client() is shared and not shared.is_closed
    # The segment route's own 30 s timeout, set per request on the shared client
    assert all(request.extensions["timeout"]["read"] == 30 for request in requests)


async def test_manifest_poll_keeps_its_10s_timeout(downstream: httpx.AsyncClient) -> None:
    requests: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            text="#EXTM3U\n#EXTINF:4,\nlive000010.ts\n",
            headers={"content-type": "application/vnd.apple.mpegurl"},
        )

    mock_upstream(ERSATZTV, upstream)
    url = f"{UPSTREAM}/iptv/session/8/hls.m3u8"
    encoded = HLSManifestRewriter()._encode_url(url)

    response = await downstream.get(f"/api/ersatztv/stream/ch8?url={encoded}")

    assert response.status_code == 200
    assert requests[0].extensions["timeout"] == httpx.Timeout(10).as_dict()


class FailingSegment(httpx.AsyncByteStream):
    """A segment body that breaks after its first chunk."""

    def __init__(self) -> None:
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield b"partial-media"
        raise httpx.ReadError("synthetic upstream read failure")

    async def aclose(self) -> None:
        self.closed = True


async def test_mid_stream_failure_closes_the_response_and_the_client_serves_the_next(
    downstream: httpx.AsyncClient,
) -> None:
    failing = FailingSegment()

    def upstream(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("broken.ts"):
            return httpx.Response(200, stream=failing, headers={"content-type": "video/mp2t"})
        return httpx.Response(200, content=b"media", headers={"content-type": "video/mp2t"})

    shared = mock_upstream(ERSATZTV, upstream)

    with pytest.raises(httpx.ReadError):
        await downstream.get(_segment_path("broken.ts"))
    assert failing.closed

    response = await downstream.get(_segment_path("live000011.ts"))
    assert response.status_code == 200
    assert response.content == b"media"
    assert ersatztv_client() is shared and not shared.is_closed


class OpenSegment(httpx.AsyncByteStream):
    """A segment body that records whether it was closed."""

    def __init__(self) -> None:
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield b"media"

    async def aclose(self) -> None:
        self.closed = True


async def test_client_gone_before_the_body_starts_still_closes_the_response() -> None:
    """Otherwise the connection would stay checked out of the shared pool for good."""
    segment = OpenSegment()
    mock_upstream(
        ERSATZTV,
        lambda request: httpx.Response(200, stream=segment, headers={"content-type": "video/mp2t"}),
    )
    sent: list[Message] = []
    headers_pending = asyncio.Event()

    async def receive() -> Message:
        # The viewer leaves while the headers are still being sent
        await headers_pending.wait()
        return {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        sent.append(message)
        if message["type"] == "http.response.start":
            headers_pending.set()
            await asyncio.Event().wait()

    path = _segment_path("live000010.ts")
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
        await app(scope, receive, send)
    finally:
        app.dependency_overrides.pop(get_current_user_or_token, None)

    assert not any(message.get("body") for message in sent)
    assert segment.closed


async def test_aclose_closes_every_client_and_the_next_call_builds_a_new_one() -> None:
    ersatztv = ersatztv_client()
    dispatcharr = dispatcharr_client()

    await aclose_http_clients()

    assert ersatztv.is_closed and dispatcharr.is_closed
    assert ersatztv_client() is not ersatztv
    await aclose_http_clients()


@pytest.mark.parametrize("get_client", [ersatztv_client, dispatcharr_client])
def test_an_upstream_cookie_is_never_kept(get_client: Any) -> None:
    # The per-call clients started empty every time; a shared one must not hand
    # one request's Set-Cookie to every later request
    client = get_client()
    request = httpx.Request("GET", f"{UPSTREAM}/iptv/channels.m3u")
    response = httpx.Response(200, headers={"set-cookie": "session=abc; Path=/"}, request=request)

    client.cookies.extract_cookies(response)

    assert len(client.cookies) == 0


def test_lifespan_shutdown_closes_the_clients() -> None:
    ersatztv = mock_upstream(ERSATZTV, lambda request: httpx.Response(503))
    dispatcharr = mock_upstream(DISPATCHARR, lambda request: httpx.Response(503))

    with TestClient(app):
        assert not ersatztv.is_closed and not dispatcharr.is_closed

    assert ersatztv.is_closed and dispatcharr.is_closed
    assert http_clients._clients == {}


async def test_dispatcharr_status_still_follows_redirects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "dispatcharr_url", "http://dispatcharr.test")
    monkeypatch.setattr(
        "app.services.status_service.dispatcharr_auth_headers",
        lambda: {"Authorization": "ApiKey synthetic"},
    )

    def upstream(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/proxy/ts/status":
            return httpx.Response(301, headers={"location": "/proxy/ts/status/"})
        return httpx.Response(200, json={"channels": []})

    mock_upstream(DISPATCHARR, upstream)

    status = await asyncio.wait_for(get_dispatcharr_status(), 5)

    assert status.online is True
    assert status.error is None
