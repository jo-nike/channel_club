"""Tests for GIF router."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.auth import create_access_token
from app.services.gif import GifServiceError


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
    """Create valid auth header with JWT token."""
    token = create_access_token({"sub": "testuser", "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


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
            mock_settings.giphy_api_key = ""

            response = client.get("/api/gif/feature", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == {"enabled": False}

    def test_returns_enabled_true_when_api_key_set(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns enabled=true when API key is configured."""
        with patch("app.routers.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = "test-api-key"

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
