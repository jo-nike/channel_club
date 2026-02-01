"""NHL scores router for IPTV Viewer API."""

import re
from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.models.nhl import NHLScoresResponse
from app.services.nhl import NHLApiError, NHLConnectionError, get_nhl_scores

router = APIRouter(prefix="/api/nhl", tags=["nhl"])

# Date format validation pattern
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validate_date(date: str) -> None:
    """Validate date string is in YYYY-MM-DD format and represents a real date.

    Args:
        date: Date string to validate.

    Raises:
        HTTPException: 400 if date format is invalid.
    """
    if not DATE_PATTERN.match(date):
        raise HTTPException(
            status_code=400,
            detail={"message": "Invalid date format", "expected": "YYYY-MM-DD"},
        )
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail={"message": "Invalid date", "error": "Date does not exist"},
        )


@router.get("/scores", response_model=NHLScoresResponse)
async def get_scores(date: str | None = None) -> NHLScoresResponse:
    """Get NHL scores for a given date.

    Args:
        date: Optional date in YYYY-MM-DD format. Defaults to today (5am EST boundary).

    Returns:
        NHL scores response with games, date, and live game count.

    Raises:
        HTTPException: 400 if date format is invalid.
        HTTPException: 503 if NHL API is unavailable.
    """
    if date:
        _validate_date(date)

    try:
        return await get_nhl_scores(date)
    except (NHLApiError, NHLConnectionError) as e:
        raise HTTPException(
            status_code=503,
            detail={"message": "NHL API unavailable", "error": str(e)},
        ) from e
