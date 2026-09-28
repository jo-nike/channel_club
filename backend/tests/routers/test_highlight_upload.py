"""Optional shared Zipline uploads: feature gating, bounded ingestion, exact bytes."""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI
from starlette.requests import Request

from app.config import settings
from app.models.auth import TokenPayload
from app.routers import highlight as highlight_router
from app.routers.auth_deps import get_current_user
from app.routers.highlight import ingest_preview, router
from app.services.media_limits import export_budget, upload_budget


@pytest.fixture
async def client(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(
        sub="viewer", role="viewer", exp=datetime(2099, 1, 1, tzinfo=UTC)
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        yield client
    assert not export_budget.owners and not upload_budget.owners


@pytest.mark.parametrize(
    "flag,url,token,available",
    [
        (False, "", "", False),
        (False, "https://zipline.test", "secret", False),
        (True, "", "secret", False),
        (True, "https://zipline.test", "", False),
        (True, "not a url", "secret", False),
        (True, "https://zipline.test", "secret", True),
    ],
)
async def test_flag_controls_capability_and_upload_before_ingestion(
    client, monkeypatch, flag, url, token, available
):
    monkeypatch.setattr(settings, "zipline_enabled", flag)
    monkeypatch.setattr(settings, "zipline_url", url)
    monkeypatch.setattr(settings, "zipline_token", token)
    feature = await client.get("/api/highlight/feature")
    assert feature.json() == {"enabled": True, "ziplineEnabled": available}
    assert "secret" not in feature.text
    with patch("app.routers.highlight.ingest_preview", new_callable=AsyncMock) as ingest:
        response = await client.post("/api/highlight/upload", content=b"ignored")
        assert response.status_code == (415 if available else 503)
        ingest.assert_not_called()

    # The ordinary export path remains independent of Zipline configuration.
    async def encode(_source, output, *_args):
        output.write_bytes(b"mp4")
        return output

    with (
        patch("app.routers.highlight.encode_file", encode),
        patch(
            "app.routers.highlight.highlight_service.get_capture",
            return_value=SimpleNamespace(path="snapshot.mp4"),
        ),
    ):
        response = await client.post("/api/highlight/export?capture=synthetic-capture-0001")
        assert response.status_code == 200


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "zipline_enabled", True)
    monkeypatch.setattr(settings, "zipline_url", "https://zipline.test")
    monkeypatch.setattr(settings, "zipline_token", "synthetic-secret")


async def test_viewer_upload_forwards_exact_prepared_bytes(client, configured):
    seen = []

    async def handler(request):
        body = await request.aread()
        seen.append(request)
        assert request.url == "https://zipline.test/api/upload"
        assert request.headers["Authorization"] == "synthetic-secret"
        assert 'name="file"' in body.decode()
        assert "video/mp4" in body.decode()
        assert b"exact prepared selected frames" in body
        return httpx.Response(
            200, json={"files": [{"url": "https://cdn.test/c.mp4", "name": "c.mp4"}]}
        )

    real_client = httpx.AsyncClient
    with (
        patch(
            "app.services.zipline.httpx.AsyncClient",
            side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
        ),
        patch(
            "app.routers.highlight.media_duration", new_callable=AsyncMock, return_value=2.4
        ) as probe,
    ):
        response = await client.post(
            "/api/highlight/upload",
            content=b"exact prepared selected frames",
            headers={"Content-Type": "video/mp4"},
        )
    assert response.json() == {"url": "https://cdn.test/c.mp4", "name": "c.mp4"}
    assert len(seen) == 1
    # The clip was held in a workspace the startup sweep covers, and removed afterwards.
    assert probe.await_args is not None
    source = probe.await_args.args[0]
    assert source.parent.parent == Path(settings.highlight_temp_dir) / "work"
    assert not source.parent.exists()


@pytest.mark.parametrize(
    "status,body,expected",
    [
        (401, {}, 502),
        (403, {}, 502),
        (413, {}, 413),
        (429, {}, 429),
        (400, {"error": "quota exceeded synthetic-secret"}, 502),
        (302, {}, 502),
        (200, {"files": []}, 502),
        (200, {"files": [{"url": "javascript:alert(1)", "name": "clip"}]}, 502),
    ],
)
async def test_upstream_failures_are_sanitized_and_not_retried(
    client, configured, status, body, expected
):
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(status, json=body, headers={"Location": "https://other.test"})

    real_client = httpx.AsyncClient
    with (
        patch(
            "app.services.zipline.httpx.AsyncClient",
            side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
        ),
        patch("app.routers.highlight.media_duration", new_callable=AsyncMock, return_value=2),
    ):
        response = await client.post(
            "/api/highlight/upload", content=b"preview", headers={"Content-Type": "video/mp4"}
        )
    assert response.status_code == expected
    assert "synthetic-secret" not in response.text
    assert len(seen) == 1


async def test_timeout_warns_about_unknown_completion(client, configured):
    def handler(request):
        raise httpx.ReadTimeout("synthetic-secret")

    real_client = httpx.AsyncClient
    with (
        patch(
            "app.services.zipline.httpx.AsyncClient",
            side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
        ),
        patch("app.routers.highlight.media_duration", new_callable=AsyncMock, return_value=2),
    ):
        response = await client.post(
            "/api/highlight/upload", content=b"preview", headers={"Content-Type": "video/mp4"}
        )
    assert response.status_code == 504
    assert "may have arrived" in response.json()["detail"]
    assert "synthetic-secret" not in response.text


async def test_limits_reject_before_probe_or_upstream(client, configured, monkeypatch):
    monkeypatch.setattr(settings, "media_export_max_bytes", 4)
    with patch("app.routers.highlight.upload_clip", new_callable=AsyncMock) as upload:
        assert (
            await client.post(
                "/api/highlight/upload", content=b"12345", headers={"Content-Type": "video/mp4"}
            )
        ).status_code == 413
        assert (
            await client.post(
                "/api/highlight/upload", content=b"", headers={"Content-Type": "video/mp4"}
            )
        ).status_code == 400
        upload.assert_not_called()


async def test_an_upload_in_flight_leaves_the_export_slots_free(client, configured):
    async def upload(*_args):
        assert upload_budget.owners == {"viewer": 1}
        # The same viewer can still capture or export while Zipline receives the clip.
        with export_budget.slot("viewer"):
            pass
        return {"url": "https://cdn.test/c.mp4", "name": "c.mp4"}

    with (
        patch("app.routers.highlight.upload_clip", upload),
        patch("app.routers.highlight.media_duration", new_callable=AsyncMock, return_value=2),
    ):
        response = await client.post(
            "/api/highlight/upload", content=b"preview", headers={"Content-Type": "video/mp4"}
        )
    assert response.status_code == 200


async def test_upload_requires_authentication(configured):
    app = FastAPI()
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/highlight/upload", content=b"preview", headers={"Content-Type": "video/mp4"}
        )
    assert response.status_code == 401


def paced(chunks: int, pause: float, stall_after: int | None = None, stall: float = 0):
    """A body sent in small chunks with a pause before each, like a slow phone uplink."""

    async def body():
        for index in range(chunks):
            await asyncio.sleep(stall if index == stall_after else pause)
            yield b"x" * 1024

    return body()


async def test_a_slow_upload_is_timed_per_chunk_not_for_the_whole_body(
    client, configured, monkeypatch
):
    monkeypatch.setattr(highlight_router, "UPLOAD_IDLE_SECONDS", 0.3)
    upload = AsyncMock(return_value={"url": "https://cdn.test/c.mp4", "name": "c.mp4"})
    with (
        patch("app.routers.highlight.upload_clip", upload),
        patch("app.routers.highlight.media_duration", new_callable=AsyncMock, return_value=2),
    ):
        # Ten chunks 0.1 s apart take a second in all, well past the idle limit.
        response = await client.post(
            "/api/highlight/upload",
            content=paced(10, 0.1),
            headers={"Content-Type": "video/mp4"},
        )
        assert response.status_code == 200
        stalled = await client.post(
            "/api/highlight/upload",
            content=paced(3, 0.01, stall_after=1, stall=0.6),
            headers={"Content-Type": "video/mp4"},
        )
    assert stalled.status_code == 408
    upload.assert_awaited_once()


async def test_ingest_writes_chunks_without_a_worker_thread(tmp_path):
    """A saturated default executor must not stall or time out the body read (N-02)."""
    loop = asyncio.get_running_loop()
    executor = ThreadPoolExecutor(max_workers=1)
    loop.set_default_executor(executor)
    gate = threading.Event()
    loop.run_in_executor(None, gate.wait)
    messages = [
        {"type": "http.request", "body": b"x" * 65536, "more_body": True} for _ in range(64)
    ] + [{"type": "http.request", "body": b"", "more_body": False}]

    async def receive():
        return messages.pop(0)

    request = Request({"type": "http", "method": "POST", "headers": []}, receive)
    try:
        await asyncio.wait_for(ingest_preview(request, tmp_path / "clip.mp4"), 2)
    finally:
        gate.set()
        executor.shutdown(wait=True)
    assert (tmp_path / "clip.mp4").stat().st_size == 64 * 65536
