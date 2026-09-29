"""Tests for GIF service."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from io import StringIO
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from loguru import logger
from pydantic import SecretStr

from app.config import settings
from app.services.gif import GifService, GifServiceError

_RealAsyncClient = httpx.AsyncClient


def _giphy_replies(
    handler: Callable[[httpx.Request], httpx.Response],
) -> AbstractContextManager[object]:
    """Patch the service's AsyncClient so requests go to a MockTransport handler."""

    def make_client(*, timeout: float, verify: object) -> httpx.AsyncClient:
        return _RealAsyncClient(transport=httpx.MockTransport(handler), timeout=timeout)

    return patch("app.services.gif.httpx.AsyncClient", side_effect=make_client)


@pytest.fixture
def service() -> GifService:
    """Create fresh GIF service instance for testing."""
    svc = GifService()
    svc.clear_cache()
    return svc


@pytest.fixture
def mock_giphy_response() -> dict:
    """Sample Giphy API response."""
    return {
        "data": [
            {
                "id": "gif1",
                "title": "Funny Cat",
                "images": {
                    "original": {
                        "url": "https://giphy.com/gif1.gif",
                        "width": "480",
                        "height": "360",
                    },
                    "fixed_width_small": {
                        "url": "https://giphy.com/gif1_small.gif",
                    },
                },
            },
            {
                "id": "gif2",
                "title": "Dancing Dog",
                "images": {
                    "original": {
                        "url": "https://giphy.com/gif2.gif",
                        "width": "640",
                        "height": "480",
                    },
                    "fixed_width_small": {
                        "url": "https://giphy.com/gif2_small.gif",
                    },
                },
            },
        ],
        "pagination": {
            "total_count": 100,
            "count": 2,
            "offset": 0,
        },
    }


class TestGifServiceEnabled:
    """Tests for _is_enabled method."""

    def test_returns_false_when_api_key_is_none(self, service: GifService) -> None:
        """Returns False when API key is not set."""
        with patch("app.services.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = None
            assert service._is_enabled() is False

    def test_returns_false_when_api_key_is_empty(self, service: GifService) -> None:
        """Returns False when API key is empty string."""
        with patch("app.services.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = SecretStr("")
            assert service._is_enabled() is False

    def test_returns_true_when_api_key_is_set(self, service: GifService) -> None:
        """Returns True when API key is set."""
        with patch("app.services.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = SecretStr("test-api-key")
            assert service._is_enabled() is True


class TestGetTrending:
    """Tests for get_trending method."""

    @pytest.mark.asyncio
    async def test_raises_error_when_disabled(self, service: GifService) -> None:
        """Raises GifServiceError when feature is disabled."""
        with patch("app.services.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = None

            with pytest.raises(GifServiceError) as exc:
                await service.get_trending()

            assert "not configured" in str(exc.value)

    @pytest.mark.asyncio
    async def test_fetches_trending_from_api(
        self, service: GifService, mock_giphy_response: dict
    ) -> None:
        """Fetches trending GIFs from Giphy API."""
        mock_response = MagicMock()
        mock_response.json.return_value = mock_giphy_response
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = SecretStr("test-key")

            with patch("httpx.AsyncClient") as MockClient:
                mock_client_instance = AsyncMock()
                mock_client_instance.get = AsyncMock(return_value=mock_response)
                mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
                mock_client_instance.__aexit__ = AsyncMock(return_value=None)
                MockClient.return_value = mock_client_instance

                result = await service.get_trending(limit=25)

        assert len(result["gifs"]) == 2
        assert result["gifs"][0]["id"] == "gif1"
        assert result["gifs"][0]["title"] == "Funny Cat"
        assert result["pagination"]["totalCount"] == 100

    @pytest.mark.asyncio
    async def test_uses_cached_result(self, service: GifService, mock_giphy_response: dict) -> None:
        """Returns cached result within cache duration."""
        mock_response = MagicMock()
        mock_response.json.return_value = mock_giphy_response
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = SecretStr("test-key")

            with patch("httpx.AsyncClient") as MockClient:
                mock_client_instance = AsyncMock()
                mock_client_instance.get = AsyncMock(return_value=mock_response)
                mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
                mock_client_instance.__aexit__ = AsyncMock(return_value=None)
                MockClient.return_value = mock_client_instance

                # First call - should hit API
                result1 = await service.get_trending()

                # Second call - should use cache
                result2 = await service.get_trending()

        # API should be called only once (cached on second call)
        assert mock_client_instance.get.call_count == 1
        assert result1 == result2

    @pytest.mark.asyncio
    async def test_handles_timeout(self, service: GifService) -> None:
        """Raises GifServiceError on timeout."""
        with patch("app.services.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = SecretStr("test-key")

            with patch("httpx.AsyncClient") as MockClient:
                mock_client_instance = AsyncMock()
                mock_client_instance.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
                mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
                mock_client_instance.__aexit__ = AsyncMock(return_value=None)
                MockClient.return_value = mock_client_instance

                with pytest.raises(GifServiceError) as exc:
                    await service.get_trending()

                assert "timed out" in str(exc.value)


class TestSearch:
    """Tests for search method."""

    @pytest.mark.asyncio
    async def test_raises_error_when_disabled(self, service: GifService) -> None:
        """Raises GifServiceError when feature is disabled."""
        with patch("app.services.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = None

            with pytest.raises(GifServiceError) as exc:
                await service.search("cats")

            assert "not configured" in str(exc.value)

    @pytest.mark.asyncio
    async def test_searches_for_gifs(self, service: GifService, mock_giphy_response: dict) -> None:
        """Searches for GIFs with query."""
        mock_response = MagicMock()
        mock_response.json.return_value = mock_giphy_response
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = SecretStr("test-key")

            with patch("httpx.AsyncClient") as MockClient:
                mock_client_instance = AsyncMock()
                mock_client_instance.get = AsyncMock(return_value=mock_response)
                mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
                mock_client_instance.__aexit__ = AsyncMock(return_value=None)
                MockClient.return_value = mock_client_instance

                result = await service.search("cats", offset=0, limit=25)

        assert len(result["gifs"]) == 2
        # Verify the search endpoint was called
        call_args = mock_client_instance.get.call_args
        assert "search" in call_args[0][0]

    @pytest.mark.asyncio
    async def test_passes_pagination_params(
        self, service: GifService, mock_giphy_response: dict
    ) -> None:
        """Passes offset and limit params to API."""
        mock_response = MagicMock()
        mock_response.json.return_value = mock_giphy_response
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.gif.settings") as mock_settings:
            mock_settings.giphy_api_key = SecretStr("test-key")

            with patch("httpx.AsyncClient") as MockClient:
                mock_client_instance = AsyncMock()
                mock_client_instance.get = AsyncMock(return_value=mock_response)
                mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
                mock_client_instance.__aexit__ = AsyncMock(return_value=None)
                MockClient.return_value = mock_client_instance

                await service.search("dogs", offset=25, limit=50)

        call_kwargs = mock_client_instance.get.call_args[1]
        assert call_kwargs["params"]["offset"] == 25
        assert call_kwargs["params"]["limit"] == 50


class TestNormalizeResponse:
    """Tests for _normalize_response method."""

    def test_normalizes_giphy_response(
        self, service: GifService, mock_giphy_response: dict
    ) -> None:
        """Normalizes Giphy response to standard format."""
        result = service._normalize_response(mock_giphy_response)

        assert len(result["gifs"]) == 2

        gif1 = result["gifs"][0]
        assert gif1["id"] == "gif1"
        assert gif1["url"] == "https://giphy.com/gif1.gif"
        assert gif1["previewUrl"] == "https://giphy.com/gif1_small.gif"
        assert gif1["width"] == 480
        assert gif1["height"] == 360
        assert gif1["title"] == "Funny Cat"

    def test_handles_empty_response(self, service: GifService) -> None:
        """Handles empty response data."""
        result = service._normalize_response({"data": [], "pagination": {}})

        assert result["gifs"] == []
        assert result["pagination"]["totalCount"] == 0

    def test_skips_gifs_without_url(self, service: GifService) -> None:
        """Skips GIFs that don't have a valid URL."""
        data = {
            "data": [
                {
                    "id": "gif1",
                    "title": "No URL GIF",
                    "images": {"original": {}},  # No URL
                },
                {
                    "id": "gif2",
                    "title": "Has URL",
                    "images": {
                        "original": {
                            "url": "https://giphy.com/gif2.gif",
                            "width": "100",
                            "height": "100",
                        }
                    },
                },
            ],
            "pagination": {},
        }

        result = service._normalize_response(data)

        # Only the GIF with URL should be included
        assert len(result["gifs"]) == 1
        assert result["gifs"][0]["id"] == "gif2"


class TestMalformedReplies:
    """E-16: malformed Giphy replies are a GifServiceError (503), not a 500."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("method", ["trending", "search"])
    async def test_html_reply_is_service_error(
        self, service: GifService, monkeypatch: pytest.MonkeyPatch, method: str
    ) -> None:
        monkeypatch.setattr(settings, "giphy_api_key", "test-key")

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, text="<html>captive</html>", headers={"content-type": "text/html"}
            )

        with _giphy_replies(handler), pytest.raises(GifServiceError) as exc:
            if method == "trending":
                await service.get_trending()
            else:
                await service.search("cats")

        assert str(exc.value) == "GIF service returned an invalid response"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("payload", [{"data": {"id": "x"}}, ["not", "a", "dict"]])
    async def test_wrong_shape_is_service_error(
        self, service: GifService, monkeypatch: pytest.MonkeyPatch, payload: object
    ) -> None:
        monkeypatch.setattr(settings, "giphy_api_key", "test-key")

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=payload)

        with _giphy_replies(handler), pytest.raises(GifServiceError) as exc:
            await service.search("cats")

        assert str(exc.value) == "GIF service returned an invalid response"

    @pytest.mark.asyncio
    async def test_item_with_bad_dimensions_is_skipped(
        self, service: GifService, monkeypatch: pytest.MonkeyPatch, mock_giphy_response: dict
    ) -> None:
        monkeypatch.setattr(settings, "giphy_api_key", "test-key")
        mock_giphy_response["data"].insert(
            1,
            {
                "id": "bad",
                "images": {
                    "original": {"url": "https://giphy.com/bad.gif", "width": "abc", "height": "1"}
                },
            },
        )

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=mock_giphy_response)

        with _giphy_replies(handler):
            result = await service.search("cats")

        assert [gif["id"] for gif in result["gifs"]] == ["gif1", "gif2"]


class TestGiphyStatusMapping:
    """M-04: Giphy error statuses map to honest client statuses."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("giphy_status", "headers", "status", "retry_after", "message"),
        [
            (429, {"Retry-After": "12"}, 429, "12", "GIF service is busy; try again later"),
            (429, {}, 429, "30", "GIF service is busy; try again later"),
            (401, {}, 502, None, "GIF service misconfigured"),
            (403, {}, 502, None, "GIF service misconfigured"),
            (400, {}, 502, None, "GIF service rejected the request"),
            (414, {}, 502, None, "GIF service rejected the request"),
            (500, {}, 503, None, "GIF service unavailable"),
        ],
    )
    @pytest.mark.parametrize("method", ["trending", "search"])
    async def test_maps_status(
        self,
        service: GifService,
        monkeypatch: pytest.MonkeyPatch,
        method: str,
        giphy_status: int,
        headers: dict[str, str],
        status: int,
        retry_after: str | None,
        message: str,
    ) -> None:
        monkeypatch.setattr(settings, "giphy_api_key", "test-key")

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(giphy_status, text="giphy says no", headers=headers)

        with _giphy_replies(handler), pytest.raises(GifServiceError) as exc:
            if method == "trending":
                await service.get_trending()
            else:
                await service.search("cats")

        assert exc.value.status_code == status
        assert exc.value.retry_after == retry_after
        assert str(exc.value) == message

    @pytest.mark.asyncio
    async def test_log_truncates_body_and_omits_api_key(
        self, service: GifService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "giphy_api_key", "secret-giphy-key")
        body = "x" * 199 + "TAIL" + "y" * 2000

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, text=body)

        output = StringIO()
        handler_id = logger.add(output, format="{message}", level="DEBUG")
        try:
            with _giphy_replies(handler), pytest.raises(GifServiceError):
                await service.search("cats")
        finally:
            logger.remove(handler_id)

        logged = output.getvalue()
        assert "x" * 199 + "T" in logged
        assert "TAIL" not in logged
        assert "secret-giphy-key" not in logged


class TestUrlFilter:
    """M-04: only https URLs on giphy.com hosts reach the client."""

    @staticmethod
    def _item(gif_id: str, url: str, preview: str | None = None) -> dict:
        images: dict = {"original": {"url": url, "width": "1", "height": "1"}}
        if preview is not None:
            images["fixed_width_small"] = {"url": preview}
        return {"id": gif_id, "images": images}

    @pytest.mark.parametrize(
        "url",
        [
            "javascript:alert(1)",
            "https://evil.test/a.gif",
            "https://giphy.com.evil.test/a.gif",
            "https://notgiphy.com/a.gif",
            "http://media.giphy.com/a.gif",
            "https://[bad/a.gif",
            123,
        ],
    )
    def test_drops_item_with_bad_url(self, service: GifService, url: object) -> None:
        data = {
            "data": [
                {"id": "bad", "images": {"original": {"url": url}}},
                self._item("good", "https://media2.giphy.com/good.gif"),
            ]
        }

        result = service._normalize_response(data)

        assert [gif["id"] for gif in result["gifs"]] == ["good"]

    def test_bad_preview_falls_back_to_url(self, service: GifService) -> None:
        data = {
            "data": [
                self._item("a", "https://giphy.com/a.gif", "javascript:alert(1)"),
                self._item("b", "https://i.giphy.com/b.gif", "https://evil.test/b.gif"),
            ]
        }

        result = service._normalize_response(data)

        assert [gif["previewUrl"] for gif in result["gifs"]] == [
            "https://giphy.com/a.gif",
            "https://i.giphy.com/b.gif",
        ]


class TestClearCache:
    """Tests for clear_cache method."""

    def test_clears_trending_cache(self, service: GifService) -> None:
        """Clears the trending cache."""
        service._trending_cache = {"gifs": []}
        service._trending_cached_at = datetime.now(UTC)

        service.clear_cache()

        assert service._trending_cache is None
        assert service._trending_cached_at is None
