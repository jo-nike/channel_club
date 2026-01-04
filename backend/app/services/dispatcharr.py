"""Dispatcharr API client service."""

import httpx
from loguru import logger

from app.config import settings
from app.models.channel import Channel, DispatchrrChannel

# Module-level logger with service context
log = logger.bind(service="dispatcharr")


class DispatchrrUnavailableError(Exception):
    """Raised when Dispatcharr API is unreachable or returns an error."""

    pass


def extract_uuid(url: str) -> str:
    """Extract stream UUID from Dispatcharr URL.

    Args:
        url: Dispatcharr stream URL in format http://host/proxy/ts/stream/{uuid}

    Returns:
        The UUID portion of the URL (last path segment).
    """
    return url.split("/")[-1]


async def get_lineup() -> list[Channel]:
    """Fetch and transform channel lineup from Dispatcharr.

    Returns:
        List of Channel objects with transformed stream URLs.

    Raises:
        DispatchrrUnavailableError: If Dispatcharr is unreachable or returns error.
    """
    url = f"{settings.dispatcharr_url}/hdhr/lineup.json"
    log.debug("Fetching channel lineup from {}", url)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            response.raise_for_status()

            raw_channels = [DispatchrrChannel(**c) for c in response.json()]

            channels = [
                Channel(
                    id=extract_uuid(ch.url),
                    name=ch.guide_name,
                    stream_url=f"{settings.stream_base_url}/proxy/ts/stream/{extract_uuid(ch.url)}",
                    guide_id=ch.guide_id,
                )
                for ch in raw_channels
            ]

            log.info("Fetched {} channels successfully", len(channels))
            return channels
    except httpx.HTTPError as e:
        log.error("Failed to fetch channels: {}", str(e))
        raise DispatchrrUnavailableError(f"Failed to fetch channels: {e}") from e
