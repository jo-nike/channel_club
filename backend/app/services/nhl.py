"""NHL scores service for fetching and caching data from the NHL API."""

import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from loguru import logger

from app.models.nhl import NHLBroadcast, NHLGame, NHLScoresResponse, NHLSituation, NHLTeam

# Module-level logger with service context
log = logger.bind(service="nhl")

# NHL API configuration
NHL_API_BASE = "https://api-web.nhle.com/v1"
NHL_TIMEOUT_SECONDS = 10
CACHE_TTL_SECONDS = 10  # Short TTL for live score updates
DAY_BOUNDARY_HOUR = 5  # 5am EST - late games show on correct day


class NHLApiError(Exception):
    """Raised when NHL API returns a non-200 response."""

    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


class NHLConnectionError(Exception):
    """Raised when connection to NHL API fails."""

    pass


# In-memory cache
_cache: dict[str, tuple[NHLScoresResponse, float]] = {}


def get_effective_date() -> str:
    """Get effective date using 5am EST boundary.

    The NHL site considers "today" to start around noon EST, but we want
    the day to change at 5am EST instead. This means late games (past midnight)
    still show on the previous day until 5am.

    Returns:
        Date string in YYYY-MM-DD format for the effective game day.
    """
    est = ZoneInfo("America/New_York")
    now = datetime.now(est)

    # If before 5am EST, use yesterday's date
    # Use timedelta to handle month/year boundaries correctly
    if now.hour < DAY_BOUNDARY_HOUR:
        now = now - timedelta(days=1)

    return now.strftime("%Y-%m-%d")


def _map_game_state(state: str) -> str:
    """Map NHL API state to normalized status.

    Args:
        state: NHL API game state code (FUT, PRE, LIVE, CRIT, FINAL, OFF).

    Returns:
        Normalized status: 'scheduled', 'live', or 'final'.
    """
    match state:
        case "FUT" | "PRE":
            return "scheduled"
        case "LIVE" | "CRIT":
            return "live"
        case "FINAL" | "OFF":
            return "final"
        case _:
            return "scheduled"


def _format_period(period_number: int, period_type: str) -> str:
    """Format period for display.

    Handles regular season and playoff period numbering:
    - Periods 1-3: Regular periods ("1st", "2nd", "3rd")
    - Period 4 with OT type: First overtime ("OT")
    - Period 5+ with OT type: Multiple overtimes ("2OT", "3OT", etc.) - playoffs only
    - SO type: Shootout ("SO") - regular season only after OT

    Args:
        period_number: Period number (1-3 for regulation, 4+ for OT/SO).
        period_type: Period type code from API (REG, OT, SO).

    Returns:
        Human-readable period string (e.g., "1st", "OT", "2OT", "SO").
    """
    if period_type == "OT":
        return "OT" if period_number == 4 else f"{period_number - 3}OT"
    if period_type == "SO":
        return "SO"

    match period_number:
        case 1:
            return "1st"
        case 2:
            return "2nd"
        case 3:
            return "3rd"
        case _:
            return f"{period_number}th"


def _transform_game(api_game: dict[str, Any]) -> NHLGame:
    """Transform NHL API game to normalized format.

    Args:
        api_game: Raw game data from NHL API.

    Returns:
        Normalized NHLGame for frontend.
    """
    status = _map_game_state(api_game.get("gameState", "FUT"))

    # Extract team data
    home_team_data = api_game.get("homeTeam", {})
    away_team_data = api_game.get("awayTeam", {})

    home_logo = home_team_data.get("logo", "")
    away_logo = away_team_data.get("logo", "")

    home_team = NHLTeam(
        name=home_team_data.get("name", {}).get("default", "Unknown"),
        abbreviation=home_team_data.get("abbrev", "???"),
        score=home_team_data.get("score") or 0,
        logo=home_logo,
        logo_dark=home_logo.replace("_light.svg", "_dark.svg"),
    )

    away_team = NHLTeam(
        name=away_team_data.get("name", {}).get("default", "Unknown"),
        abbreviation=away_team_data.get("abbrev", "???"),
        score=away_team_data.get("score") or 0,
        logo=away_logo,
        logo_dark=away_logo.replace("_light.svg", "_dark.svg"),
    )

    # Build game center link
    game_center_link = api_game.get("gameCenterLink", "")
    if game_center_link:
        game_center_link = f"https://www.nhl.com{game_center_link}/"

    game = NHLGame(
        id=api_game.get("id", 0),
        status=status,
        home_team=home_team,
        away_team=away_team,
        start_time=api_game.get("startTimeUTC", ""),
        game_center_link=game_center_link,
    )

    # Add live game details
    if status == "live":
        period_desc = api_game.get("periodDescriptor", {})
        clock = api_game.get("clock", {})

        if period_desc and clock:
            period_number = period_desc.get("number", 1)
            period_type = period_desc.get("periodType", "REG")
            game.period = _format_period(period_number, period_type)
            game.time_remaining = clock.get("timeRemaining")
            game.is_intermission = clock.get("inIntermission", False)

    # Add final game outcome
    if status == "final":
        game_outcome = api_game.get("gameOutcome", {})
        last_period_type = game_outcome.get("lastPeriodType")
        if last_period_type and last_period_type != "REG":
            game.outcome_type = last_period_type

    # Add TV broadcasts (dedupe by (network, market, countryCode) — the API
    # occasionally lists the same network twice with different sequenceNumbers)
    broadcasts_data = api_game.get("tvBroadcasts") or []
    seen: set[tuple[str, str, str]] = set()
    for b in broadcasts_data:
        network = b.get("network")
        if not network:
            continue
        market = b.get("market", "")
        country = b.get("countryCode", "")
        key = (network, market, country)
        if key in seen:
            continue
        seen.add(key)
        game.broadcasts.append(NHLBroadcast(network=network, market=market, country_code=country))

    # Add situation (power play, etc.)
    situation_data = api_game.get("situation")
    if situation_data:
        game.situation = NHLSituation(
            away_strength=situation_data.get("awayTeam", {}).get("strength", "5"),
            home_strength=situation_data.get("homeTeam", {}).get("strength", "5"),
            time_remaining=situation_data.get("timeRemaining"),
            away_description=situation_data.get("awayTeam", {}).get("situationDescriptions"),
            home_description=situation_data.get("homeTeam", {}).get("situationDescriptions"),
        )

    return game


async def get_nhl_scores(date: str | None = None) -> NHLScoresResponse:
    """Fetch NHL scores for a given date.

    Uses a 10-second in-memory cache to reduce API calls during live games.

    Args:
        date: Optional date in YYYY-MM-DD format. Defaults to effective date (5am EST boundary).

    Returns:
        NHLScoresResponse with games, date, and live game count.

    Raises:
        NHLApiError: If NHL API returns non-200 response.
        NHLConnectionError: If connection to NHL API fails or times out.
    """
    global _cache

    # Use effective date (5am EST boundary) when no date specified
    effective_date = date or get_effective_date()
    cache_key = effective_date

    # Check cache
    if cache_key in _cache:
        cached_data, timestamp = _cache[cache_key]
        if time.time() - timestamp < CACHE_TTL_SECONDS:
            log.debug("Cache hit for NHL scores (date={})", effective_date)
            return cached_data

    # Fetch from NHL API
    endpoint = f"{NHL_API_BASE}/score/{effective_date}"
    log.debug("Fetching NHL scores from {}", endpoint)

    try:
        async with httpx.AsyncClient(timeout=NHL_TIMEOUT_SECONDS) as client:
            response = await client.get(
                endpoint,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "IPTVViewer/1.0",
                },
            )

            if not response.is_success:
                log.error("NHL API error: {} for {}", response.status_code, endpoint)
                raise NHLApiError(f"NHL API error: {response.status_code}", response.status_code)

            api_data = response.json()

    except httpx.TimeoutException as e:
        log.warning("NHL API connection timed out")
        raise NHLConnectionError("Connection timed out") from e
    except httpx.HTTPError as e:
        log.error("NHL API connection error: {}", e)
        raise NHLConnectionError(str(e)) from e

    # Transform games
    games = [_transform_game(game) for game in api_data.get("games", [])]
    live_game_count = sum(1 for g in games if g.status == "live")

    result = NHLScoresResponse(
        games=games,
        date=api_data.get("currentDate", effective_date),
        live_game_count=live_game_count,
    )

    # Cache the result, dropping entries whose TTL has lapsed first - any valid
    # date is a cache key, so without eviction the cache grows without bound
    now = time.time()
    for stale_key in [k for k, (_, ts) in _cache.items() if now - ts >= CACHE_TTL_SECONDS]:
        del _cache[stale_key]
    _cache[cache_key] = (result, now)
    log.info("Fetched {} NHL games ({} live) for {}", len(games), live_game_count, effective_date)

    return result


def clear_nhl_cache() -> None:
    """Clear the NHL scores cache (for testing)."""
    global _cache
    _cache.clear()
