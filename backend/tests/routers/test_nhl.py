"""Tests for NHL router endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models.nhl import NHLBroadcast, NHLGame, NHLScoresResponse, NHLTeam
from app.routers.nhl import router
from app.services.nhl import NHLApiError, NHLConnectionError


@pytest.fixture
def app() -> FastAPI:
    """Create test FastAPI app with NHL router."""
    app = FastAPI()
    app.include_router(router)
    return app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    """Create test client."""
    return TestClient(app)


class TestGetScoresEndpoint:
    """Tests for GET /api/nhl/scores endpoint."""

    def test_get_scores_success(self, client: TestClient) -> None:
        """Returns 200 with scores on success."""
        mock_response = NHLScoresResponse(
            games=[
                NHLGame(
                    id=2024020123,
                    status="live",
                    home_team=NHLTeam(
                        name="Boston Bruins",
                        abbreviation="BOS",
                        score=2,
                        logo="https://test.com/bos_light.svg",
                        logo_dark="https://test.com/bos_dark.svg",
                    ),
                    away_team=NHLTeam(
                        name="Montreal Canadiens",
                        abbreviation="MTL",
                        score=1,
                        logo="https://test.com/mtl_light.svg",
                        logo_dark="https://test.com/mtl_dark.svg",
                    ),
                    start_time="2026-01-15T00:00:00Z",
                    game_center_link="https://nhl.com/gamecenter/test",
                    period="2nd",
                    time_remaining="08:45",
                    is_intermission=False,
                ),
            ],
            date="2026-01-15",
            live_game_count=1,
        )

        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response

            response = client.get("/api/nhl/scores")

        assert response.status_code == 200
        data = response.json()
        assert data["date"] == "2026-01-15"
        assert data["liveGameCount"] == 1
        assert len(data["games"]) == 1
        assert data["games"][0]["status"] == "live"
        assert data["games"][0]["homeTeam"]["abbreviation"] == "BOS"

    def test_get_scores_includes_broadcasts(self, client: TestClient) -> None:
        """Broadcasts are serialized with camelCase aliases."""
        mock_response = NHLScoresResponse(
            games=[
                NHLGame(
                    id=1,
                    status="scheduled",
                    home_team=NHLTeam(
                        name="Carolina Hurricanes",
                        abbreviation="CAR",
                        score=0,
                        logo="x",
                        logo_dark="x",
                    ),
                    away_team=NHLTeam(
                        name="Ottawa Senators",
                        abbreviation="OTT",
                        score=0,
                        logo="x",
                        logo_dark="x",
                    ),
                    start_time="2026-04-18T23:00:00Z",
                    game_center_link="",
                    broadcasts=[
                        NHLBroadcast(network="ESPN", market="N", country_code="US"),
                        NHLBroadcast(network="SN", market="N", country_code="CA"),
                    ],
                ),
            ],
            date="2026-04-18",
            live_game_count=0,
        )

        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response
            response = client.get("/api/nhl/scores")

        assert response.status_code == 200
        broadcasts = response.json()["games"][0]["broadcasts"]
        assert broadcasts == [
            {"network": "ESPN", "market": "N", "countryCode": "US"},
            {"network": "SN", "market": "N", "countryCode": "CA"},
        ]

    def test_get_scores_with_date_parameter(self, client: TestClient) -> None:
        """Passes date parameter to service."""
        mock_response = NHLScoresResponse(
            games=[],
            date="2026-01-10",
            live_game_count=0,
        )

        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response

            response = client.get("/api/nhl/scores?date=2026-01-10")

        assert response.status_code == 200
        mock_get.assert_called_once_with("2026-01-10")

    def test_get_scores_empty_games(self, client: TestClient) -> None:
        """Returns empty games array when no games."""
        mock_response = NHLScoresResponse(
            games=[],
            date="2026-07-15",
            live_game_count=0,
        )

        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response

            response = client.get("/api/nhl/scores")

        assert response.status_code == 200
        data = response.json()
        assert data["games"] == []
        assert data["liveGameCount"] == 0

    def test_get_scores_api_error_returns_503(self, client: TestClient) -> None:
        """Returns 503 when NHL API returns error."""
        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = NHLApiError("NHL API error: 500", 500)

            response = client.get("/api/nhl/scores")

        assert response.status_code == 503
        data = response.json()
        assert "detail" in data
        assert data["detail"]["message"] == "NHL API unavailable"

    def test_get_scores_connection_error_returns_503(self, client: TestClient) -> None:
        """Returns 503 when connection to NHL API fails."""
        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = NHLConnectionError("Connection timed out")

            response = client.get("/api/nhl/scores")

        assert response.status_code == 503
        data = response.json()
        assert "detail" in data
        assert data["detail"]["message"] == "NHL API unavailable"

    def test_get_scores_final_game_with_overtime(self, client: TestClient) -> None:
        """Returns correct outcome type for OT games."""
        mock_response = NHLScoresResponse(
            games=[
                NHLGame(
                    id=2024020124,
                    status="final",
                    home_team=NHLTeam(
                        name="Tampa Bay Lightning",
                        abbreviation="TBL",
                        score=3,
                        logo="https://test.com/tbl_light.svg",
                        logo_dark="https://test.com/tbl_dark.svg",
                    ),
                    away_team=NHLTeam(
                        name="Florida Panthers",
                        abbreviation="FLA",
                        score=2,
                        logo="https://test.com/fla_light.svg",
                        logo_dark="https://test.com/fla_dark.svg",
                    ),
                    start_time="2026-01-15T00:00:00Z",
                    game_center_link="https://nhl.com/gamecenter/test",
                    outcome_type="OT",
                ),
            ],
            date="2026-01-15",
            live_game_count=0,
        )

        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response

            response = client.get("/api/nhl/scores")

        assert response.status_code == 200
        data = response.json()
        assert data["games"][0]["outcomeType"] == "OT"


class TestDateValidation:
    """Tests for date parameter validation."""

    def test_invalid_date_format_returns_400(self, client: TestClient) -> None:
        """Returns 400 for invalid date format."""
        response = client.get("/api/nhl/scores?date=invalid")

        assert response.status_code == 400
        data = response.json()
        assert data["detail"]["message"] == "Invalid date format"

    def test_invalid_date_value_returns_400(self, client: TestClient) -> None:
        """Returns 400 for invalid date value (e.g., Feb 30)."""
        response = client.get("/api/nhl/scores?date=2026-02-30")

        assert response.status_code == 400
        data = response.json()
        assert data["detail"]["message"] == "Invalid date"

    def test_path_traversal_attempt_returns_400(self, client: TestClient) -> None:
        """Returns 400 for path traversal attempts."""
        response = client.get("/api/nhl/scores?date=../../../etc/passwd")

        assert response.status_code == 400

    def test_valid_date_passes_validation(self, client: TestClient) -> None:
        """Valid date passes validation and calls service."""
        mock_response = NHLScoresResponse(
            games=[],
            date="2026-01-15",
            live_game_count=0,
        )

        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response

            response = client.get("/api/nhl/scores?date=2026-01-15")

        assert response.status_code == 200
        mock_get.assert_called_once_with("2026-01-15")
