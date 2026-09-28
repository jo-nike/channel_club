"""GIF service for fetching GIFs from Giphy API.

This service provides:
- Trending GIF fetching
- GIF search with pagination
- Response normalization to consistent format
- Caching of trending results
"""

from datetime import UTC, datetime, timedelta

import httpx
from loguru import logger

from app.config import settings
from app.services.tls import SSL_CONTEXT

log = logger.bind(service="gif")

GIPHY_BASE_URL = "https://api.giphy.com/v1/gifs"

# Cache duration for trending GIFs
TRENDING_CACHE_MINUTES = 5


class GifServiceError(Exception):
    """Raised when GIF service encounters an error."""

    pass


class GifService:
    """Service for fetching GIFs from Giphy API."""

    def __init__(self) -> None:
        self._trending_cache: dict | None = None
        self._trending_limit: int | None = None
        self._trending_cached_at: datetime | None = None

    def _is_enabled(self) -> bool:
        """Check if GIF feature is enabled."""
        return settings.giphy_api_key is not None and len(settings.giphy_api_key) > 0

    async def get_trending(self, limit: int = 25) -> dict:
        """Get trending GIFs.

        Results are cached for 5 minutes to reduce API calls.

        Args:
            limit: Maximum number of GIFs to return (max 50).

        Returns:
            Normalized GIF response with gifs list and pagination info.

        Raises:
            GifServiceError: If the API request fails.
        """
        if not self._is_enabled():
            raise GifServiceError("GIF feature is not configured (missing API key)")

        limit = max(1, min(limit, 50))
        # The one-entry cache includes the requested result shape in its key.
        if self._trending_cache and self._trending_cached_at and self._trending_limit == limit:
            cache_age = datetime.now(UTC) - self._trending_cached_at
            if cache_age < timedelta(minutes=TRENDING_CACHE_MINUTES):
                log.debug("Returning cached trending GIFs")
                return self._trending_cache

        log.debug("Fetching trending GIFs from Giphy API")

        try:
            async with httpx.AsyncClient(timeout=10.0, verify=SSL_CONTEXT) as client:
                response = await client.get(
                    f"{GIPHY_BASE_URL}/trending",
                    params={
                        "api_key": settings.giphy_api_key,
                        "limit": min(limit, 50),
                        "rating": "pg-13",
                    },
                )
                response.raise_for_status()
        except httpx.TimeoutException:
            log.error("Giphy API request timed out")
            raise GifServiceError("GIF service timed out") from None
        except httpx.HTTPStatusError as e:
            log.error("Giphy API error: {} {}", e.response.status_code, e.response.text)
            raise GifServiceError(f"GIF service error: {e.response.status_code}") from None
        except httpx.RequestError as e:
            log.error("Giphy API request failed: {}", str(e))
            raise GifServiceError("GIF service unavailable") from None

        result = self._parse_response(response)

        # Cache the result
        self._trending_limit = limit
        self._trending_cache = result
        self._trending_cached_at = datetime.now(UTC)
        log.debug("Cached {} trending GIFs", len(result.get("gifs", [])))

        return result

    async def search(self, query: str, offset: int = 0, limit: int = 25) -> dict:
        """Search for GIFs.

        Args:
            query: Search query string.
            offset: Result offset for pagination.
            limit: Maximum number of GIFs to return (max 50).

        Returns:
            Normalized GIF response with gifs list and pagination info.

        Raises:
            GifServiceError: If the API request fails.
        """
        if not self._is_enabled():
            raise GifServiceError("GIF feature is not configured (missing API key)")

        log.debug("Searching Giphy API for: {} (offset={})", query, offset)

        try:
            async with httpx.AsyncClient(timeout=10.0, verify=SSL_CONTEXT) as client:
                response = await client.get(
                    f"{GIPHY_BASE_URL}/search",
                    params={
                        "api_key": settings.giphy_api_key,
                        "q": query,
                        "limit": min(limit, 50),
                        "offset": offset,
                        "rating": "pg-13",
                    },
                )
                response.raise_for_status()
        except httpx.TimeoutException:
            log.error("Giphy API search timed out for query: {}", query)
            raise GifServiceError("GIF service timed out") from None
        except httpx.HTTPStatusError as e:
            log.error(
                "Giphy API search error: {} {}",
                e.response.status_code,
                e.response.text,
            )
            raise GifServiceError(f"GIF service error: {e.response.status_code}") from None
        except httpx.RequestError as e:
            log.error("Giphy API search request failed: {}", str(e))
            raise GifServiceError("GIF service unavailable") from None

        result = self._parse_response(response)
        log.debug("Search returned {} GIFs", len(result.get("gifs", [])))

        return result

    def _parse_response(self, response: httpx.Response) -> dict:
        """Decode and normalize a Giphy reply, mapping malformed data to GifServiceError."""
        try:
            return self._normalize_response(response.json())
        except (ValueError, TypeError, KeyError, AttributeError):
            log.error("Giphy API returned an invalid response")
            raise GifServiceError("GIF service returned an invalid response") from None

    def _normalize_response(self, data: dict) -> dict:
        """Normalize Giphy API response to consistent format.

        Args:
            data: Raw response from Giphy API.

        Returns:
            Normalized response with gifs list and pagination.
        """
        items = data.get("data", [])
        if not isinstance(items, list):
            raise ValueError("Giphy response data is not a list")

        gifs = []
        for item in items:
            images = item.get("images", {})

            # Get the original GIF URL
            original = images.get("original", {})
            original_url = original.get("url", "")

            # Get a smaller preview for the grid
            preview = images.get("fixed_width_small", {}) or images.get("fixed_width", {})
            preview_url = preview.get("url", original_url)

            # Extract dimensions; skip an item whose dimensions are not numeric
            try:
                width = int(original.get("width", 0) or 0)
                height = int(original.get("height", 0) or 0)
            except (ValueError, TypeError):
                continue

            if original_url:  # Only include if we have a valid URL
                gifs.append(
                    {
                        "id": item.get("id", ""),
                        "url": original_url,
                        "previewUrl": preview_url,
                        "width": width,
                        "height": height,
                        "title": item.get("title", ""),
                    }
                )

        pagination = data.get("pagination", {})

        return {
            "gifs": gifs,
            "pagination": {
                "totalCount": pagination.get("total_count", 0),
                "count": pagination.get("count", len(gifs)),
                "offset": pagination.get("offset", 0),
            },
        }

    def clear_cache(self) -> None:
        """Clear the trending cache. Useful for testing."""
        self._trending_cache = None
        self._trending_cached_at = None
        log.debug("GIF trending cache cleared")


# Module-level singleton
gif_service = GifService()
