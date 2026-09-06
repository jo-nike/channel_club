"""MEDIA-08: enforce actual body size independent of Content-Length."""

import asyncio
from unittest.mock import patch

import httpx
import pytest

from app.services import bounded_http
from app.services.ersatztv.hls_rewriter import fetch_ersatztv


class Chunks(httpx.AsyncByteStream):
    def __init__(self, slow=False):
        self.closed = False
        self.read = 0
        self.slow = slow

    async def __aiter__(self):
        for _ in range(20):
            if self.slow:
                await asyncio.sleep(0.03)
            self.read += 1
            yield b"x" * 65536

    async def aclose(self):
        self.closed = True


@pytest.mark.parametrize("declared", [None, "1", "garbage"])
@pytest.mark.asyncio
async def test_chunked_limit_closes_upstream(declared):
    stream = Chunks()
    response = httpx.Response(
        200, stream=stream, headers={} if declared is None else {"Content-Length": declared}
    )
    with pytest.raises(ValueError, match="budget"):
        await bounded_http.read_bounded(response, 65536)
    assert stream.closed and stream.read == 2


@pytest.mark.asyncio
async def test_total_body_deadline_closes_slow_drip(monkeypatch):
    stream = Chunks(slow=True)
    monkeypatch.setattr(bounded_http, "BODY_SECONDS", 0.01)
    with pytest.raises(TimeoutError):
        await bounded_http.read_bounded(httpx.Response(200, stream=stream), 999999)
    assert stream.closed


@pytest.mark.asyncio
async def test_manifest_video_mime_rejected_before_read():
    stream = Chunks()

    def upstream(req):
        return httpx.Response(200, headers={"Content-Type": "video/mp2t"}, stream=stream)

    with patch("app.services.ersatztv.hls_rewriter.settings.ersatztv_base_url", "http://source"):
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            with pytest.raises(ValueError, match="not an HLS"):
                await fetch_ersatztv(client, "http://source/video.ts")
    assert stream.closed and stream.read == 0


def test_feed_cap_closes_without_materializing_full_body(monkeypatch):
    class Feed(httpx.SyncByteStream):
        closed = False
        read = 0

        def __iter__(self):
            for _ in range(10):
                self.read += 1
                yield b"x" * 20

        def close(self):
            self.closed = True

    stream = Feed()
    response = httpx.Response(
        200, stream=stream, request=httpx.Request("GET", "http://source/feed")
    )
    from contextlib import contextmanager

    @contextmanager
    def fixture(*args, **kwargs):
        try:
            yield response
        finally:
            response.close()

    monkeypatch.setattr(bounded_http, "FEED_BYTES", 25)
    monkeypatch.setattr(httpx, "stream", fixture)
    with pytest.raises(ValueError, match="budget"):
        bounded_http.fetch_feed("http://source/feed")
    assert stream.closed and stream.read == 2
