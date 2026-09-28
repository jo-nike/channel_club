"""GET /api/health/deps: coarse upstream readiness from local state only (H-03)."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.main import app
from app.services.dispatcharr import DispatchrrUnavailableError, get_grouped_channels
from app.services.epg_service import get_epg_service


def _route_upstreams(monkeypatch: pytest.MonkeyPatch, respond) -> None:
    """Send every httpx client the services open through a MockTransport."""
    factory = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: factory(transport=httpx.MockTransport(respond), **kwargs),
    )


def _no_upstream_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"/api/health/deps contacted an upstream: {request.url}")

    _route_upstreams(monkeypatch, fail)


# Captured at import, before a test routes httpx.AsyncClient to a fake upstream
_ASYNC_CLIENT = httpx.AsyncClient


async def _get_deps() -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with _ASYNC_CLIENT(transport=transport, base_url="http://test") as client:
        return await client.get("/api/health/deps")


async def test_failing_refreshes_report_failing_without_contacting_upstream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _route_upstreams(monkeypatch, lambda request: httpx.Response(403))
    assert await get_epg_service().refresh_cache() is False
    with pytest.raises(DispatchrrUnavailableError):
        await get_grouped_channels()
    _no_upstream_calls(monkeypatch)

    response = await _get_deps()

    assert response.status_code == 200
    assert response.json() == {"epg": "failing", "epgLastSuccess": None, "dispatcharr": "failing"}


async def test_healthy_guide_and_catalogue_report_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    success = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)
    guide = get_epg_service()
    guide._cache = {"synthetic": []}
    guide._cache_expires = datetime.now(UTC) + timedelta(hours=1)
    guide._last_success_at = success
    _no_upstream_calls(monkeypatch)

    response = await _get_deps()

    assert response.json() == {
        "epg": "ok",
        "epgLastSuccess": success.isoformat(),
        "dispatcharr": "ok",
    }


async def test_expired_guide_with_failing_refreshes_reports_stale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guide = get_epg_service()
    guide._cache = {"synthetic": []}
    guide._cache_expires = datetime.now(UTC) - timedelta(seconds=1)
    guide._last_success_at = datetime.now(UTC) - timedelta(hours=2)
    guide._last_error = "HTTP 403"
    _no_upstream_calls(monkeypatch)

    response = await _get_deps()

    body = response.json()
    assert body["epg"] == "stale"
    assert "HTTP 403" not in response.text
    assert set(body) == {"epg", "epgLastSuccess", "dispatcharr"}


def test_health_stays_static() -> None:
    """The Docker healthcheck's endpoint does not grow upstream state."""
    from fastapi.testclient import TestClient

    body = TestClient(app).get("/api/health").json()

    assert set(body) == {"status", "version", "buildId", "revision"}
