"""Dispatcharr API client service."""

import httpx

from app.config import settings
from app.models.channel import Channel, DispatchrrChannel


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
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{settings.dispatcharr_url}/hdhr/lineup.json")
            response.raise_for_status()

            raw_channels = [DispatchrrChannel(**c) for c in response.json()]

            return [
                Channel(
                    id=extract_uuid(ch.url),
                    name=ch.guide_name,
                    stream_url=f"{settings.stream_base_url}/proxy/ts/stream/{extract_uuid(ch.url)}",
                    guide_id=ch.guide_id,
                )
                for ch in raw_channels
            ]
    except httpx.HTTPError as e:
        raise DispatchrrUnavailableError(f"Failed to fetch channels: {e}") from e
