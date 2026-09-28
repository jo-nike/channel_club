"""MEDIA-12: result count and pagination cannot leak between limit choices."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.config import settings
from app.services.gif import GifService


@pytest.mark.asyncio
@pytest.mark.parametrize("limits", [(1, 50, 1), (25, 1, 25)])
async def test_limit_participates_in_trending_cache_key(monkeypatch, limits):
    monkeypatch.setattr(settings, "giphy_api_key", "synthetic")

    async def get(url, *, params):
        count = params["limit"]
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": str(i),
                        "images": {"original": {"url": f"https://media.giphy.com/{i}.gif"}},
                    }
                    for i in range(count)
                ],
                "pagination": {"count": count, "offset": 0, "total_count": 100},
            },
            request=httpx.Request("GET", url),
        )

    client = AsyncMock()
    client.__aenter__.return_value = client
    client.get.side_effect = get
    service = GifService()
    with patch("app.services.gif.httpx.AsyncClient", return_value=client):
        result = None
        for limit in limits:
            result = await service.get_trending(limit)
            assert len(result["gifs"]) == limit
            assert result["pagination"]["count"] == limit
        assert result is not None
        cached = await service.get_trending(limits[-1])
        assert cached == result
    assert client.get.call_count == len(limits)
