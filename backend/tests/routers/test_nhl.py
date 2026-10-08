"""Tests for NHL router endpoints."""

from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.models.auth import TokenPayload
from app.models.nhl import NHLBroadcast, NHLGame, NHLScoresResponse, NHLTeam
from app.routers.auth_deps import get_current_user
from app.routers.nhl import router
from app.services.nhl import NHLApiError, NHLConnectionError


@pytest.fixture(autouse=True)
def fixed_today() -> Iterator[None]:
    """Pin the router's idea of today so the date window is deterministic."""
    with patch("app.routers.nhl.get_effective_date", return_value="2026-01-15"):
        yield


@pytest.fixture(autouse=True)
def nhl_on(monkeypatch: pytest.MonkeyPatch) -> None:
    """NHL scores are an extra, off by default; these tests switch them on."""
    monkeypatch.setattr(settings, "nhl_enabled", True)


@pytest.fixture
def app() -> FastAPI:
    """Create test FastAPI app with NHL router and a signed-in viewer."""
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(
        sub="viewer", role="viewer", exp=datetime(2099, 1, 1, tzinfo=UTC)
    )
    return app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    """Create test client."""
    return TestClient(app)


class TestGetScoresEndpoint:
    """Tests for GET /api/nhl/scores endpoint."""

    def test_anonymous_request_is_rejected(self) -> None:
        """Without a bearer token the endpoint refuses and never calls the service."""
        app = FastAPI()
        app.include_router(router)

        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            response = TestClient(app).get("/api/nhl/scores")

        assert response.status_code == 401
        mock_get.assert_not_called()

    def test_off_is_503_without_asking_the_nhl(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "nhl_enabled", False)

        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            response = client.get("/api/nhl/scores")

        assert response.status_code == 503
        assert response.json() == {"detail": {"message": "NHL scores are off"}}
        mock_get.assert_not_called()

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
        assert data["detail"] == {"message": "NHL API unavailable"}

    def test_get_scores_connection_error_returns_503(self, client: TestClient) -> None:
        """Returns 503 when connection to NHL API fails."""
        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = NHLConnectionError("[Errno 111] Connection refused")

            response = client.get("/api/nhl/scores")

        assert response.status_code == 503
        data = response.json()
        assert "detail" in data
        assert data["detail"] == {"message": "NHL API unavailable"}
        assert "Errno" not in response.text

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

    @pytest.mark.parametrize("date", ["2025-12-15", "2026-02-15", "0001-01-01", "9999-12-31"])
    def test_date_outside_window_returns_400(self, client: TestClient, date: str) -> None:
        """Dates more than 30 days from today are rejected before any upstream call."""
        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            response = client.get(f"/api/nhl/scores?date={date}")

        assert response.status_code == 400
        assert response.json()["detail"]["message"] == "Date out of range"
        mock_get.assert_not_called()

    @pytest.mark.parametrize("date", ["2025-12-16", "2026-02-14"])
    def test_date_at_window_edge_is_accepted(self, client: TestClient, date: str) -> None:
        """Dates exactly 30 days either side of today are accepted."""
        mock_response = NHLScoresResponse(games=[], date=date, live_game_count=0)

        with patch("app.routers.nhl.get_nhl_scores", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response
            response = client.get(f"/api/nhl/scores?date={date}")

        assert response.status_code == 200
        mock_get.assert_called_once_with(date)

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
