"""NHL scores router for Channel Club API."""

import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.models.auth import TokenPayload
from app.models.nhl import NHLScoresResponse
from app.routers.auth_deps import get_current_user
from app.services.nhl import NHLApiError, NHLConnectionError, get_effective_date, get_nhl_scores

router = APIRouter(prefix="/api/nhl", tags=["nhl"])

# Date format validation pattern
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Dates further than this from today are rejected: each distinct date costs an
# upstream NHL call, so the window bounds how many a caller can trigger
DATE_WINDOW_DAYS = 30


def _validate_date(date: str) -> None:
    """Validate date string is in YYYY-MM-DD format and represents a real date.

    Args:
        date: Date string to validate.

    Raises:
        HTTPException: 400 if date format is invalid or outside the date window.
    """
    if not DATE_PATTERN.match(date):
        raise HTTPException(
            status_code=400,
            detail={"message": "Invalid date format", "expected": "YYYY-MM-DD"},
        )
    try:
        requested = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail={"message": "Invalid date", "error": "Date does not exist"},
        ) from None
    today = datetime.strptime(get_effective_date(), "%Y-%m-%d")
    if abs(requested - today) > timedelta(days=DATE_WINDOW_DAYS):
        raise HTTPException(
            status_code=400,
            detail={"message": "Date out of range", "maxDaysFromToday": DATE_WINDOW_DAYS},
        )


@router.get("/scores", response_model=NHLScoresResponse)
async def get_scores(
    date: str | None = None,
    user: TokenPayload = Depends(get_current_user),
) -> NHLScoresResponse:
    """Get NHL scores for a given date.

    Args:
        date: Optional date in YYYY-MM-DD format. Defaults to today (5am EST boundary).

    Returns:
        NHL scores response with games, date, and live game count.

    Raises:
        HTTPException: 400 if date format is invalid or outside the date window.
        HTTPException: 503 if NHL scores are off on this server, or NHL API is unavailable.
    """
    if not settings.nhl_enabled:
        raise HTTPException(status_code=503, detail={"message": "NHL scores are off"})
    if date:
        _validate_date(date)

    try:
        return await get_nhl_scores(date)
    except (NHLApiError, NHLConnectionError) as e:
        raise HTTPException(
            status_code=503,
            detail={"message": "NHL API unavailable"},
        ) from e
