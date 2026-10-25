"""Final resource URL remains the base for query-only HLS references."""

import base64
import re
from unittest.mock import AsyncMock, patch
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.ersatztv import router
from app.services import stream_sessions
from app.services.ersatztv.hls_rewriter import decode_url


def test_query_only_map_resolves_against_final_manifest_resource():
    app = FastAPI()
    app.include_router(router)
    session = stream_sessions.create("fixture", "fixture")
    original = "http://upstream.invalid/folder/playlist.m3u8?session=initial"
    encoded = base64.urlsafe_b64encode(original.encode()).decode().rstrip("=")
    upstream = httpx.Response(
        200,
        text='#EXTM3U\n#EXT-X-MAP:URI="?resource=init"\n',
        request=httpx.Request("GET", original),
    )
    with (
        TestClient(app) as client,
        patch("app.routers.ersatztv.is_ersatztv_media_url", return_value=True),
        patch("app.routers.ersatztv.fetch_ersatztv", AsyncMock(return_value=upstream)),
    ):
        response = client.get(stream_sessions.manifest_path(session.id), params={"url": encoded})
    assert response.status_code == 200
    match = re.search(r'URI="([^"]+)"', response.text)
    assert match is not None
    rewritten = urlsplit(match[1])
    assert (
        decode_url(rewritten.path.rsplit("/", 1)[1])
        == "http://upstream.invalid/folder/playlist.m3u8?resource=init"
    )
