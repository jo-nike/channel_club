"""MEDIA-10: a failed upstream cannot produce a clean downstream 200 body."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.main import app
from app.routers.ersatztv import get_segment
from app.services.ersatztv.hls_rewriter import HLSManifestRewriter


class FailedSegment(httpx.AsyncByteStream):
    closed = False

    async def __aiter__(self):
        yield b"partial-media"
        raise httpx.ReadError("synthetic upstream read failure")

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_partial_upstream_raises_and_closes_both_resources():
    stream = FailedSegment()
    url = "http://192.168.50.108:8409/partial.ts"
    response = httpx.Response(200, stream=stream, request=httpx.Request("GET", url))
    client = AsyncMock()
    with (
        patch("app.routers.ersatztv.httpx.AsyncClient", return_value=client),
        patch("app.routers.ersatztv.fetch_ersatztv", return_value=response),
    ):
        downstream = await get_segment(HLSManifestRewriter()._encode_url(url), user=object())
        chunks = []
        with pytest.raises(httpx.ReadError):
            async for chunk in downstream.body_iterator:
                chunks.append(chunk)
    assert chunks == [b"partial-media"]
    assert stream.closed
    client.aclose.assert_awaited_once()


@pytest.mark.asyncio
async def test_asgi_client_observes_failure_instead_of_success():
    from app.routers.auth_deps import get_current_user_or_token

    app.dependency_overrides[get_current_user_or_token] = lambda: object()
    url = "http://192.168.50.108:8409/partial.ts"
    response = httpx.Response(200, stream=FailedSegment(), request=httpx.Request("GET", url))
    upstream = AsyncMock()
    downstream = httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test")
    try:
        with (
            patch("app.routers.ersatztv.httpx.AsyncClient", return_value=upstream),
            patch("app.routers.ersatztv.fetch_ersatztv", return_value=response),
            pytest.raises(httpx.ReadError),
        ):
            await downstream.get("/api/ersatztv/segments/" + HLSManifestRewriter()._encode_url(url))
    finally:
        await downstream.aclose()
        app.dependency_overrides.pop(get_current_user_or_token, None)
