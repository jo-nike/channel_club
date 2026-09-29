"""Tests for GIF router."""

from collections.abc import Iterator
from io import StringIO
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from loguru import logger
from pydantic import SecretStr

from app.config import settings
from app.main import app
from app.services.auth import create_access_token
from app.services.gif import GifServiceError, gif_service

_RealAsyncClient = httpx.AsyncClient


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
    """Create valid auth header with JWT token."""
    token = create_access_token({"sub": "testuser", "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def giphy_reply(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[httpx.Response]]:
    """Route the real GIF service to a MockTransport that returns the queued reply."""
    monkeypatch.setattr(settings, "giphy_api_key", "test-key")
    replies: list[httpx.Response] = []

    def make_client(*, timeout: float, verify: object) -> httpx.AsyncClient:
        transport = httpx.MockTransport(lambda request: replies[0])
        return _RealAsyncClient(transport=transport, timeout=timeout)

    gif_service.clear_cache()
    with patch("app.services.gif.httpx.AsyncClient", side_effect=make_client):
        yield replies
    gif_service.clear_cache()


class TestGetFeatureStatus:
    """Tests for GET /api/gif/feature endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/gif/feature")
        assert response.status_code == 401

    def test_returns_enabled_false_when_api_key_not_set(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns enabled=false when API key is not set."""
        with patch("app.routers.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = None

            response = client.get("/api/gif/feature", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == {"enabled": False}

    def test_returns_enabled_false_when_api_key_empty(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns enabled=false when API key is empty string."""
        with patch("app.routers.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = SecretStr("")

            response = client.get("/api/gif/feature", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == {"enabled": False}

    def test_returns_enabled_true_when_api_key_set(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns enabled=true when API key is configured."""
        with patch("app.routers.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = SecretStr("test-api-key")

            response = client.get("/api/gif/feature", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == {"enabled": True}


class TestGetTrending:
    """Tests for GET /api/gif/trending endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/gif/trending")
        assert response.status_code == 401

    def test_returns_trending_gifs(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Returns trending GIFs on success."""
        mock_result = {
            "gifs": [
                {
                    "id": "gif1",
                    "url": "https://giphy.com/gif1.gif",
                    "previewUrl": "https://giphy.com/gif1_small.gif",
                    "width": 480,
                    "height": 360,
                    "title": "Funny Cat",
                }
            ],
            "pagination": {"totalCount": 100, "count": 1, "offset": 0},
        }

        with patch("app.routers.gif.gif_service") as mock_service:
            mock_service.get_trending = AsyncMock(return_value=mock_result)

            response = client.get("/api/gif/trending", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert len(data["gifs"]) == 1
        assert data["gifs"][0]["id"] == "gif1"
        assert data["pagination"]["totalCount"] == 100

    def test_respects_limit_parameter(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Passes limit parameter to service."""
        mock_result = {"gifs": [], "pagination": {"totalCount": 0, "count": 0, "offset": 0}}

        with patch("app.routers.gif.gif_service") as mock_service:
            mock_service.get_trending = AsyncMock(return_value=mock_result)

            response = client.get("/api/gif/trending?limit=10", headers=auth_header)

        assert response.status_code == 200
        mock_service.get_trending.assert_called_once_with(10)

    def test_returns_503_on_service_error(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 503 when service fails."""
        with patch("app.routers.gif.gif_service") as mock_service:
            mock_service.get_trending = AsyncMock(side_effect=GifServiceError("API unavailable"))

            response = client.get("/api/gif/trending", headers=auth_header)

        assert response.status_code == 503
        assert "API unavailable" in response.json()["detail"]

    def test_validates_limit_max(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Validates limit parameter max value."""
        response = client.get("/api/gif/trending?limit=100", headers=auth_header)
        assert response.status_code == 422  # Validation error

    def test_giphy_rate_limit_is_429(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        giphy_reply: list[httpx.Response],
    ) -> None:
        """Trending shares the Giphy status mapping with search."""
        giphy_reply.append(httpx.Response(429, text="slow down"))

        response = client.get("/api/gif/trending", headers=auth_header)

        assert response.status_code == 429
        assert response.headers["Retry-After"] == "30"
        assert response.json()["detail"] == "GIF service is busy; try again later"


class TestSearchGifs:
    """Tests for GET /api/gif/search endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/gif/search?q=cats")
        assert response.status_code == 401

    def test_requires_query_parameter(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 422 when query parameter is missing."""
        response = client.get("/api/gif/search", headers=auth_header)
        assert response.status_code == 422

    def test_searches_for_gifs(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Searches for GIFs with query."""
        mock_result = {
            "gifs": [
                {
                    "id": "cat1",
                    "url": "https://giphy.com/cat1.gif",
                    "previewUrl": "https://giphy.com/cat1_small.gif",
                    "width": 480,
                    "height": 360,
                    "title": "Cute Cat",
                }
            ],
            "pagination": {"totalCount": 50, "count": 1, "offset": 0},
        }

        with patch("app.routers.gif.gif_service") as mock_service:
            mock_service.search = AsyncMock(return_value=mock_result)

            response = client.get("/api/gif/search?q=cats", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert len(data["gifs"]) == 1
        assert data["gifs"][0]["title"] == "Cute Cat"

    def test_passes_pagination_params(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Passes offset and limit parameters to service."""
        mock_result = {"gifs": [], "pagination": {"totalCount": 0, "count": 0, "offset": 25}}

        with patch("app.routers.gif.gif_service") as mock_service:
            mock_service.search = AsyncMock(return_value=mock_result)

            response = client.get("/api/gif/search?q=dogs&offset=25&limit=10", headers=auth_header)

        assert response.status_code == 200
        mock_service.search.assert_called_once_with("dogs", 25, 10)

    def test_returns_503_on_service_error(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 503 when service fails."""
        with patch("app.routers.gif.gif_service") as mock_service:
            mock_service.search = AsyncMock(side_effect=GifServiceError("Search failed"))

            response = client.get("/api/gif/search?q=test", headers=auth_header)

        assert response.status_code == 503
        assert "Search failed" in response.json()["detail"]

    def test_validates_query_min_length(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Validates query parameter minimum length."""
        response = client.get("/api/gif/search?q=", headers=auth_header)
        assert response.status_code == 422  # Validation error

    def test_rejects_query_over_50_characters(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        response = client.get(f"/api/gif/search?q={'a' * 51}", headers=auth_header)
        assert response.status_code == 422

    def test_rejects_whitespace_query(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        response = client.get("/api/gif/search", params={"q": "   "}, headers=auth_header)
        assert response.status_code == 422

    def test_strips_query(self, client: TestClient, auth_header: dict[str, str]) -> None:
        mock_result = {"gifs": [], "pagination": {"totalCount": 0, "count": 0, "offset": 0}}

        with patch("app.routers.gif.gif_service") as mock_service:
            mock_service.search = AsyncMock(return_value=mock_result)

            response = client.get(
                "/api/gif/search", params={"q": "  dogs  ", "offset": 4999}, headers=auth_header
            )

        assert response.status_code == 200
        mock_service.search.assert_called_once_with("dogs", 4999, 25)

    def test_rejects_offset_over_4999(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        response = client.get("/api/gif/search?q=test&offset=5000", headers=auth_header)
        assert response.status_code == 422

    def test_giphy_rate_limit_is_429_with_retry_after(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        giphy_reply: list[httpx.Response],
    ) -> None:
        giphy_reply.append(httpx.Response(429, text="slow down", headers={"Retry-After": "7"}))

        response = client.get("/api/gif/search?q=cats", headers=auth_header)

        assert response.status_code == 429
        assert response.headers["Retry-After"] == "7"
        assert "slow down" not in response.text

    def test_giphy_rate_limit_logs_no_error(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        giphy_reply: list[httpx.Response],
    ) -> None:
        giphy_reply.append(httpx.Response(429, text="slow down"))
        output = StringIO()
        handler_id = logger.add(output, format="{level}", level="WARNING")
        try:
            response = client.get("/api/gif/search?q=cats", headers=auth_header)
        finally:
            logger.remove(handler_id)

        assert response.status_code == 429
        assert "WARNING" in output.getvalue()
        assert "ERROR" not in output.getvalue()

    def test_giphy_forbidden_is_502(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        giphy_reply: list[httpx.Response],
    ) -> None:
        giphy_reply.append(httpx.Response(403, text="invalid api key"))

        response = client.get("/api/gif/search?q=cats", headers=auth_header)

        assert response.status_code == 502
        assert response.json()["detail"] == "GIF service misconfigured"
        assert "Retry-After" not in response.headers

    def test_validates_offset_non_negative(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Validates offset parameter is non-negative."""
        response = client.get("/api/gif/search?q=test&offset=-1", headers=auth_header)
        assert response.status_code == 422  # Validation error

    def test_validates_limit_range(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Validates limit parameter range."""
        # Too small
        response = client.get("/api/gif/search?q=test&limit=0", headers=auth_header)
        assert response.status_code == 422

        # Too large
        response = client.get("/api/gif/search?q=test&limit=100", headers=auth_header)
        assert response.status_code == 422


def _giphy_item(gif_id: object, title: object) -> dict[str, object]:
    return {
        "id": gif_id,
        "title": title,
        "images": {"original": {"url": "https://media.giphy.com/a.gif", "width": "480"}},
    }


@pytest.mark.parametrize("path", ["/api/gif/trending", "/api/gif/search?q=cats"])
def test_malformed_giphy_values_never_make_a_500(
    path: str,
    client: TestClient,
    auth_header: dict[str, str],
    giphy_reply: list[httpx.Response],
) -> None:
    """Bad ids are skipped, bad titles blanked and bad pagination defaulted."""
    body = {
        "data": [
            _giphy_item("abc", None),
            _giphy_item(42, 7),
            _giphy_item(None, "no id"),
            _giphy_item(1.5, "float id"),
            _giphy_item(True, "bool id"),
        ],
        "pagination": {"total_count": "lots", "count": None, "offset": True},
    }
    giphy_reply.append(httpx.Response(200, json=body))

    response = client.get(path, headers=auth_header)

    assert response.status_code == 200
    data = response.json()
    assert [(g["id"], g["title"]) for g in data["gifs"]] == [("abc", ""), ("42", "")]
    assert data["pagination"] == {"totalCount": 0, "count": 2, "offset": 0}
