"""MEDIA-10: a failed upstream cannot produce a clean downstream 200 body."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.main import app
from app.routers.ersatztv import get_session_segment
from app.services import stream_sessions
from app.services.ersatztv.hls_rewriter import HLSManifestRewriter


class FailedSegment(httpx.AsyncByteStream):
    closed = False

    async def __aiter__(self):
        yield b"partial-media"
        raise httpx.ReadError("synthetic upstream read failure")

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_partial_upstream_raises_and_closes_the_response_not_the_client():
    stream = FailedSegment()
    url = "http://ersatztv.test:8409/iptv/session/8/partial.ts"
    response = httpx.Response(200, stream=stream, request=httpx.Request("GET", url))
    client = AsyncMock()
    with (
        patch("app.routers.ersatztv.ersatztv_client", return_value=client),
        patch("app.routers.ersatztv.fetch_ersatztv", return_value=response),
    ):
        session = stream_sessions.create("acct", "8")
        downstream = await get_session_segment(session.id, HLSManifestRewriter()._encode_url(url))
        chunks = []
        with pytest.raises(httpx.ReadError):
            async for chunk in downstream.body_iterator:
                chunks.append(chunk)
    assert chunks == [b"partial-media"]
    assert stream.closed
    # The shared client stays open for the next segment
    client.aclose.assert_not_awaited()


@pytest.mark.asyncio
async def test_asgi_client_observes_failure_instead_of_success():
    session = stream_sessions.create("acct", "8")
    url = "http://ersatztv.test:8409/iptv/session/8/partial.ts"
    response = httpx.Response(200, stream=FailedSegment(), request=httpx.Request("GET", url))
    upstream = AsyncMock()
    downstream = httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test")
    try:
        with (
            patch("app.routers.ersatztv.ersatztv_client", return_value=upstream),
            patch("app.routers.ersatztv.fetch_ersatztv", return_value=response),
            pytest.raises(httpx.ReadError),
        ):
            await downstream.get(
                f"/api/ersatztv/s/{session.id}/segments/" + HLSManifestRewriter()._encode_url(url)
            )
    finally:
        await downstream.aclose()
