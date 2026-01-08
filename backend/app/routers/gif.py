"""GIF API endpoints.

Provides endpoints for:
- Checking GIF feature status
- Fetching trending GIFs
- Searching for GIFs
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from pydantic import BaseModel

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
    enabled = settings.giphy_api_key is not None and len(settings.giphy_api_key) > 0
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
        log.error("Trending GIFs fetch failed: {}", str(e))
        raise HTTPException(
            status_code=503,
            detail=str(e),
        ) from None


@router.get("/search", response_model=GifResponse)
async def search_gifs(
    q: str = Query(..., min_length=1, description="Search query"),
    offset: int = Query(default=0, ge=0, description="Result offset for pagination"),
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
        log.error("GIF search failed for query '{}': {}", q, str(e))
        raise HTTPException(
            status_code=503,
            detail=str(e),
        ) from None
