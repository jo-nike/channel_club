"""GIF API endpoints.

Provides endpoints for:
- Checking GIF feature status
- Fetching trending GIFs
- Searching for GIFs
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from pydantic import BaseModel, StringConstraints

from app.config import settings
from app.models.auth import TokenPayload
from app.routers.auth_deps import get_current_user
from app.services.gif import GifServiceError, gif_service

router = APIRouter(prefix="/api/gif", tags=["gif"])
log = logger.bind(router="gif")


class GifItem(BaseModel):
    """Individual GIF item."""

    id: str
    url: str
    previewUrl: str
    width: int
    height: int
    title: str


class GifPagination(BaseModel):
    """Pagination info for GIF responses."""

    totalCount: int
    count: int
    offset: int


class GifResponse(BaseModel):
    """Response containing GIFs and pagination."""

    gifs: list[GifItem]
    pagination: GifPagination


def _http_error(e: GifServiceError) -> HTTPException:
    """Turn a GifServiceError into the HTTP error its status code names."""
    headers = {"Retry-After": e.retry_after} if e.retry_after else None
    return HTTPException(status_code=e.status_code, detail=str(e), headers=headers)


def _log_level(e: GifServiceError) -> str:
    """A Giphy rate limit is expected under load, not an outage."""
    return "WARNING" if e.status_code == 429 else "ERROR"


class GifFeatureResponse(BaseModel):
    """Response for GIF feature status."""

    enabled: bool


@router.get("/feature", response_model=GifFeatureResponse)
async def get_feature_status(
    user: TokenPayload = Depends(get_current_user),
) -> GifFeatureResponse:
    """Check if GIF feature is enabled.

    This endpoint allows the frontend to conditionally show/hide
    the GIF button based on the server-side feature flag.
    """
    log.debug("GET /gif/feature request")
    key = settings.giphy_api_key
    enabled = key is not None and len(key.get_secret_value()) > 0
    return GifFeatureResponse(enabled=enabled)


@router.get("/trending", response_model=GifResponse)
async def get_trending(
    limit: int = Query(default=25, ge=1, le=50, description="Number of GIFs to return"),
    user: TokenPayload = Depends(get_current_user),
) -> GifResponse:
    """Get trending GIFs.

    Returns a list of currently trending GIFs from Giphy.
    Results are cached server-side for 5 minutes.
    """
    log.debug("GET /gif/trending request (limit={})", limit)

    try:
        result = await gif_service.get_trending(limit)
        return GifResponse(
            gifs=[GifItem(**gif) for gif in result["gifs"]],
            pagination=GifPagination(**result["pagination"]),
        )
    except GifServiceError as e:
        log.log(_log_level(e), "Trending GIFs fetch failed: {}", str(e))
        raise _http_error(e) from None


@router.get("/search", response_model=GifResponse)
async def search_gifs(
    # Giphy caps q at 50 characters and offset at 4999
    q: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
        Query(description="Search query"),
    ],
    offset: int = Query(default=0, ge=0, le=4999, description="Result offset for pagination"),
    limit: int = Query(default=25, ge=1, le=50, description="Number of GIFs to return"),
    user: TokenPayload = Depends(get_current_user),
) -> GifResponse:
    """Search for GIFs.

    Returns GIFs matching the search query from Giphy.
    Supports pagination via offset parameter.
    """
    log.debug("GET /gif/search request (q={}, offset={}, limit={})", q, offset, limit)

    try:
        result = await gif_service.search(q, offset, limit)
        return GifResponse(
            gifs=[GifItem(**gif) for gif in result["gifs"]],
            pagination=GifPagination(**result["pagination"]),
        )
    except GifServiceError as e:
        log.log(_log_level(e), "GIF search failed for query '{}': {}", q, str(e))
        raise _http_error(e) from None
