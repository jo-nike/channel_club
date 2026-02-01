"""Tests for NHL scores service."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.models.nhl import NHLGame, NHLScoresResponse, NHLTeam
from app.services.nhl import (
    NHLApiError,
    NHLConnectionError,
    _format_period,
    _map_game_state,
    _transform_game,
    clear_nhl_cache,
    get_effective_date,
    get_nhl_scores,
)


class TestMapGameState:
    """Tests for game state mapping."""

    def test_fut_maps_to_scheduled(self) -> None:
        """FUT state maps to scheduled."""
        assert _map_game_state("FUT") == "scheduled"

    def test_pre_maps_to_scheduled(self) -> None:
        """PRE state maps to scheduled."""
        assert _map_game_state("PRE") == "scheduled"

    def test_live_maps_to_live(self) -> None:
        """LIVE state maps to live."""
        assert _map_game_state("LIVE") == "live"

    def test_crit_maps_to_live(self) -> None:
        """CRIT state maps to live."""
        assert _map_game_state("CRIT") == "live"

    def test_final_maps_to_final(self) -> None:
        """FINAL state maps to final."""
        assert _map_game_state("FINAL") == "final"

    def test_off_maps_to_final(self) -> None:
        """OFF state maps to final."""
        assert _map_game_state("OFF") == "final"

    def test_unknown_maps_to_scheduled(self) -> None:
        """Unknown state defaults to scheduled."""
        assert _map_game_state("UNKNOWN") == "scheduled"


class TestFormatPeriod:
    """Tests for period formatting."""

    def test_first_period(self) -> None:
        """Period 1 returns '1st'."""
        assert _format_period(1, "REG") == "1st"

    def test_second_period(self) -> None:
        """Period 2 returns '2nd'."""
        assert _format_period(2, "REG") == "2nd"

    def test_third_period(self) -> None:
        """Period 3 returns '3rd'."""
        assert _format_period(3, "REG") == "3rd"

    def test_first_overtime(self) -> None:
        """Period 4 with OT type returns 'OT'."""
        assert _format_period(4, "OT") == "OT"

    def test_double_overtime(self) -> None:
        """Period 5 with OT type returns '2OT'."""
        assert _format_period(5, "OT") == "2OT"

    def test_triple_overtime(self) -> None:
        """Period 6 with OT type returns '3OT'."""
        assert _format_period(6, "OT") == "3OT"

    def test_shootout(self) -> None:
        """SO type returns 'SO'."""
        assert _format_period(5, "SO") == "SO"


class TestTransformGame:
    """Tests for game transformation."""

    def test_transform_scheduled_game(self) -> None:
        """Transform scheduled game."""
        api_game = {
            "id": 2024020123,
            "gameState": "FUT",
            "homeTeam": {
                "name": {"default": "Boston Bruins"},
                "abbrev": "BOS",
                "score": None,
                "logo": "https://assets.nhle.com/logos/nhl/svg/BOS_light.svg",
            },
            "awayTeam": {
                "name": {"default": "Montreal Canadiens"},
                "abbrev": "MTL",
                "score": None,
                "logo": "https://assets.nhle.com/logos/nhl/svg/MTL_light.svg",
            },
            "startTimeUTC": "2026-01-15T00:00:00Z",
            "gameCenterLink": "/gamecenter/mtl-vs-bos/2024/01/15/2024020123",
        }

        result = _transform_game(api_game)

        assert result.id == 2024020123
        assert result.status == "scheduled"
        assert result.home_team.name == "Boston Bruins"
        assert result.home_team.abbreviation == "BOS"
        assert result.home_team.score == 0
        assert result.away_team.abbreviation == "MTL"
        assert "BOS_dark.svg" in result.home_team.logo_dark
        assert result.period is None
        assert result.outcome_type is None

    def test_transform_live_game(self) -> None:
        """Transform live game with period and time."""
        api_game = {
            "id": 2024020124,
            "gameState": "LIVE",
            "homeTeam": {
                "name": {"default": "Tampa Bay Lightning"},
                "abbrev": "TBL",
                "score": 2,
                "logo": "https://assets.nhle.com/logos/nhl/svg/TBL_light.svg",
            },
            "awayTeam": {
                "name": {"default": "Florida Panthers"},
                "abbrev": "FLA",
                "score": 3,
                "logo": "https://assets.nhle.com/logos/nhl/svg/FLA_light.svg",
            },
            "startTimeUTC": "2026-01-15T00:00:00Z",
            "gameCenterLink": "/gamecenter/fla-vs-tbl/2024/01/15/2024020124",
            "periodDescriptor": {"number": 2, "periodType": "REG"},
            "clock": {"timeRemaining": "08:45", "inIntermission": False},
        }

        result = _transform_game(api_game)

        assert result.status == "live"
        assert result.home_team.score == 2
        assert result.away_team.score == 3
        assert result.period == "2nd"
        assert result.time_remaining == "08:45"
        assert result.is_intermission is False

    def test_transform_final_game_regulation(self) -> None:
        """Transform final game ending in regulation."""
        api_game = {
            "id": 2024020125,
            "gameState": "FINAL",
            "homeTeam": {
                "name": {"default": "Toronto Maple Leafs"},
                "abbrev": "TOR",
                "score": 4,
                "logo": "https://assets.nhle.com/logos/nhl/svg/TOR_light.svg",
            },
            "awayTeam": {
                "name": {"default": "Ottawa Senators"},
                "abbrev": "OTT",
                "score": 2,
                "logo": "https://assets.nhle.com/logos/nhl/svg/OTT_light.svg",
            },
            "startTimeUTC": "2026-01-15T00:00:00Z",
            "gameCenterLink": "/gamecenter/ott-vs-tor/2024/01/15/2024020125",
            "gameOutcome": {"lastPeriodType": "REG"},
        }

        result = _transform_game(api_game)

        assert result.status == "final"
        assert result.outcome_type is None  # REG doesn't set outcome_type

    def test_transform_final_game_overtime(self) -> None:
        """Transform final game ending in overtime."""
        api_game = {
            "id": 2024020126,
            "gameState": "FINAL",
            "homeTeam": {
                "name": {"default": "Detroit Red Wings"},
                "abbrev": "DET",
                "score": 3,
                "logo": "https://assets.nhle.com/logos/nhl/svg/DET_light.svg",
            },
            "awayTeam": {
                "name": {"default": "Columbus Blue Jackets"},
                "abbrev": "CBJ",
                "score": 2,
                "logo": "https://assets.nhle.com/logos/nhl/svg/CBJ_light.svg",
            },
            "startTimeUTC": "2026-01-15T00:00:00Z",
            "gameCenterLink": "/gamecenter/cbj-vs-det/2024/01/15/2024020126",
            "gameOutcome": {"lastPeriodType": "OT"},
        }

        result = _transform_game(api_game)

        assert result.outcome_type == "OT"

    def test_transform_game_with_situation(self) -> None:
        """Transform game with power play situation."""
        api_game = {
            "id": 2024020127,
            "gameState": "LIVE",
            "homeTeam": {
                "name": {"default": "New York Rangers"},
                "abbrev": "NYR",
                "score": 1,
                "logo": "https://assets.nhle.com/logos/nhl/svg/NYR_light.svg",
            },
            "awayTeam": {
                "name": {"default": "New Jersey Devils"},
                "abbrev": "NJD",
                "score": 1,
                "logo": "https://assets.nhle.com/logos/nhl/svg/NJD_light.svg",
            },
            "startTimeUTC": "2026-01-15T00:00:00Z",
            "gameCenterLink": "/gamecenter/njd-vs-nyr/2024/01/15/2024020127",
            "periodDescriptor": {"number": 2, "periodType": "REG"},
            "clock": {"timeRemaining": "15:30", "inIntermission": False},
            "situation": {
                "homeTeam": {"strength": "5", "situationDescriptions": ["PP"]},
                "awayTeam": {"strength": "4"},
                "timeRemaining": "1:45",
            },
        }

        result = _transform_game(api_game)

        assert result.situation is not None
        assert result.situation.home_strength == "5"
        assert result.situation.away_strength == "4"
        assert result.situation.time_remaining == "1:45"
        assert result.situation.home_description == ["PP"]


class TestGetEffectiveDate:
    """Tests for effective date calculation."""

    def test_returns_date_string_format(self) -> None:
        """Returns date in YYYY-MM-DD format."""
        result = get_effective_date()
        assert len(result) == 10
        assert result[4] == "-"
        assert result[7] == "-"

    def test_handles_first_day_of_month(self) -> None:
        """Correctly handles month boundary (first day of month before 5am)."""
        from datetime import datetime
        from zoneinfo import ZoneInfo

        est = ZoneInfo("America/New_York")
        # Mock January 1st at 3am EST
        mock_time = datetime(2026, 1, 1, 3, 0, 0, tzinfo=est)

        with patch("app.services.nhl.datetime") as mock_datetime:
            mock_datetime.now.return_value = mock_time
            mock_datetime.strptime = datetime.strptime

            result = get_effective_date()

        # Should return December 31st, not crash
        assert result == "2025-12-31"

    def test_handles_first_day_of_year(self) -> None:
        """Correctly handles year boundary."""
        from datetime import datetime
        from zoneinfo import ZoneInfo

        est = ZoneInfo("America/New_York")
        # Mock March 1st at 4am EST (handles Feb -> Mar boundary)
        mock_time = datetime(2026, 3, 1, 4, 0, 0, tzinfo=est)

        with patch("app.services.nhl.datetime") as mock_datetime:
            mock_datetime.now.return_value = mock_time
            mock_datetime.strptime = datetime.strptime

            result = get_effective_date()

        # Should return February 28th
        assert result == "2026-02-28"


class TestGetNhlScores:
    """Tests for NHL scores fetching."""

    @pytest.fixture(autouse=True)
    def clear_cache(self) -> None:
        """Clear cache before each test."""
        clear_nhl_cache()

    @pytest.mark.asyncio
    async def test_get_scores_success(self) -> None:
        """Successfully fetch and transform NHL scores."""
        api_response = {
            "games": [
                {
                    "id": 2024020123,
                    "gameState": "LIVE",
                    "homeTeam": {
                        "name": {"default": "Test Home"},
                        "abbrev": "HOM",
                        "score": 2,
                        "logo": "https://test.com/home_light.svg",
                    },
                    "awayTeam": {
                        "name": {"default": "Test Away"},
                        "abbrev": "AWY",
                        "score": 1,
                        "logo": "https://test.com/away_light.svg",
                    },
                    "startTimeUTC": "2026-01-15T00:00:00Z",
                    "gameCenterLink": "/gamecenter/test",
                    "periodDescriptor": {"number": 2, "periodType": "REG"},
                    "clock": {"timeRemaining": "10:00", "inIntermission": False},
                },
            ],
            "currentDate": "2026-01-15",
        }

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.json.return_value = api_response

        with patch("app.services.nhl.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            result = await get_nhl_scores("2026-01-15")

        assert result.date == "2026-01-15"
        assert len(result.games) == 1
        assert result.live_game_count == 1
        assert result.games[0].status == "live"

    @pytest.mark.asyncio
    async def test_get_scores_uses_cache(self) -> None:
        """Returns cached data when cache is valid."""
        api_response = {
            "games": [],
            "currentDate": "2026-01-15",
        }

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.json.return_value = api_response

        with patch("app.services.nhl.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            # First call - should hit API
            await get_nhl_scores("2026-01-15")
            # Second call - should use cache
            await get_nhl_scores("2026-01-15")

        # Should only be called once due to caching
        assert mock_client.get.call_count == 1

    @pytest.mark.asyncio
    async def test_get_scores_api_error_raises(self) -> None:
        """Raises NHLApiError on non-200 response."""
        mock_response = MagicMock()
        mock_response.is_success = False
        mock_response.status_code = 500

        with patch("app.services.nhl.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with pytest.raises(NHLApiError) as exc_info:
                await get_nhl_scores("2026-01-15")

        assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_get_scores_timeout_raises(self) -> None:
        """Raises NHLConnectionError on timeout."""
        with patch("app.services.nhl.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.TimeoutException("Timeout")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with pytest.raises(NHLConnectionError, match="Connection timed out"):
                await get_nhl_scores("2026-01-15")

    @pytest.mark.asyncio
    async def test_get_scores_connection_error_raises(self) -> None:
        """Raises NHLConnectionError on connection failure."""
        with patch("app.services.nhl.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with pytest.raises(NHLConnectionError):
                await get_nhl_scores("2026-01-15")


class TestClearNhlCache:
    """Tests for cache clearing."""

    @pytest.mark.asyncio
    async def test_clear_cache_removes_entries(self) -> None:
        """Clearing cache removes all cached entries."""
        api_response = {"games": [], "currentDate": "2026-01-15"}

        mock_response = MagicMock()
        mock_response.is_success = True
        mock_response.json.return_value = api_response

        with patch("app.services.nhl.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            # Populate cache
            await get_nhl_scores("2026-01-15")

            # Clear cache
            clear_nhl_cache()

            # Should call API again since cache is cleared
            await get_nhl_scores("2026-01-15")

        assert mock_client.get.call_count == 2
