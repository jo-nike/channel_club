"""ErsatzTV stream sessions (H-01) and the stream routes' shared behaviour (C-11)."""

from collections.abc import Callable, MutableMapping
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.main import app
from app.models.ersatztv import EPGChannel
from app.services.auth import create_access_token

UPSTREAM = "http://192.168.50.108:8409"


@pytest.fixture
def channel() -> EPGChannel:
    return EPGChannel(
        id="8",
        name="Eight",
        stream_url=f"{UPSTREAM}/iptv/channel/8.m3u8",
        number=8,
    )


def _patched_upstream(handler: Callable[[httpx.Request], httpx.Response]):
    real_client = httpx.AsyncClient
    return patch(
        "app.routers.ersatztv.httpx.AsyncClient",
        side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )


class TestClientDisconnectStopsStartupRetries:
    """C-11: a cold-start loop stops once the client has gone."""

    @pytest.mark.asyncio
    async def test_disconnect_stops_retrying(self, channel: EPGChannel) -> None:
        calls: list[httpx.Request] = []

        def upstream(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return httpx.Response(404, text="not yet")  # a cold start

        token = create_access_token({"sub": "viewer", "role": "viewer"})
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
            "path": "/api/ersatztv/stream/8",
            "raw_path": b"/api/ersatztv/stream/8",
            "root_path": "",
            "query_string": b"",
            "headers": [(b"host", b"test"), (b"authorization", f"Bearer {token}".encode())],
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
