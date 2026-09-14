"""Optional shared Zipline uploads: feature gating, bounded ingestion, exact bytes."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI

from app.config import settings
from app.models.auth import TokenPayload
from app.routers.auth_deps import get_current_user
from app.routers.highlight import router
from app.services.media_limits import export_budget


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(settings, "highlight_enabled", True)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(
        sub="viewer", role="viewer", exp=datetime(2099, 1, 1, tzinfo=UTC)
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        yield client
    assert not export_budget.owners


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
    with (
        patch("app.routers.highlight.encode_file", new_callable=AsyncMock, return_value=b"mp4"),
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
        patch("app.routers.highlight.media_duration", new_callable=AsyncMock, return_value=2.4),
    ):
        response = await client.post(
            "/api/highlight/upload",
            content=b"exact prepared selected frames",
            headers={"Content-Type": "video/mp4"},
        )
    assert response.json() == {"url": "https://cdn.test/c.mp4", "name": "c.mp4"}
    assert len(seen) == 1


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
