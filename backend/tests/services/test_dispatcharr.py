"""Tests for Dispatcharr service."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from pydantic import SecretStr

from app.models.channel import (
    DispatchrrChannelGroup,
    DispatchrrFullChannel,
    GroupedChannelsResponse,
)
from app.services import dispatcharr
from app.services.dispatcharr import (
    DispatchrrUnavailableError,
    _build_grouped_channels,
    dispatcharr_auth_headers,
    extract_uuid,
    format_channel_number,
    get_channel_groups,
)
from app.services.epg_service import get_epg_service
from app.services.http_clients import DISPATCHARR
from tests.http_helpers import mock_upstream


class TestDispatcharrAuthHeaders:
    """Tests for dispatcharr_auth_headers."""

    def test_builds_apikey_header(self) -> None:
        """Should send the key using Dispatcharr's ApiKey scheme, not Bearer."""
        with patch("app.services.dispatcharr.settings") as mock_settings:
            mock_settings.dispatcharr_api_key = SecretStr("secret-key")
            assert dispatcharr_auth_headers() == {"Authorization": "ApiKey secret-key"}

    def test_raises_when_api_key_missing(self) -> None:
        """Should fail loudly rather than issuing an unauthenticated request."""
        with patch("app.services.dispatcharr.settings") as mock_settings:
            mock_settings.dispatcharr_api_key = None
            with pytest.raises(DispatchrrUnavailableError, match="DISPATCHARR_API_KEY"):
                dispatcharr_auth_headers()

    @pytest.mark.asyncio
    async def test_channel_groups_sends_api_key(self) -> None:
        """Authenticated calls should carry the API key header."""
        requests: list[httpx.Request] = []

        def upstream(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=[])

        mock_upstream(DISPATCHARR, upstream)
        with patch("app.services.dispatcharr.settings") as mock_settings:
            mock_settings.dispatcharr_api_key = SecretStr("secret-key")
            mock_settings.dispatcharr_url = "http://test:9191"
            await get_channel_groups()

        assert requests[0].headers["authorization"] == "ApiKey secret-key"

    @pytest.mark.asyncio
    async def test_channel_groups_raises_without_api_key(self) -> None:
        """No key configured should surface as DispatchrrUnavailableError (503)."""
        with patch("app.services.dispatcharr.settings") as mock_settings:
            mock_settings.dispatcharr_api_key = None
            with pytest.raises(DispatchrrUnavailableError):
                await get_channel_groups()


class TestExtractUuid:
    """Tests for extract_uuid utility function."""

    def test_extract_uuid_from_standard_url(self) -> None:
        """Extract UUID from standard Dispatcharr URL."""
        url = "http://10.8.0.2:9191/proxy/ts/stream/abc-123-def-456"
        assert extract_uuid(url) == "abc-123-def-456"

    def test_extract_uuid_from_url_with_long_uuid(self) -> None:
        """Extract UUID from URL with full UUID format."""
        url = "http://10.8.0.2:9191/proxy/ts/stream/550e8400-e29b-41d4-a716-446655440000"
        assert extract_uuid(url) == "550e8400-e29b-41d4-a716-446655440000"

    def test_extract_uuid_preserves_entire_path_segment(self) -> None:
        """UUID extraction gets the last path segment regardless of format."""
        url = "http://10.8.0.2:9191/proxy/ts/stream/my-stream-id"
        assert extract_uuid(url) == "my-stream-id"


class TestFormatChannelNumber:
    """Tests for format_channel_number, which mirrors Dispatcharr's formatting."""

    def test_whole_number_has_no_decimal_part(self) -> None:
        assert format_channel_number(28) == "28"
        assert format_channel_number(7.0) == "7"

    def test_fractional_number_keeps_its_decimal_part(self) -> None:
        assert format_channel_number(5.1) == "5.1"

    def test_missing_number_is_none(self) -> None:
        assert format_channel_number(None) is None


class TestBuildGroupedChannels:
    """Tests for the grouped catalogue's guide ids."""

    @staticmethod
    async def _build(raw_channels: list[dict[str, object]]) -> GroupedChannelsResponse:
        # Validate the raw Dispatcharr JSON the way get_channels_with_groups does
        channels = [DispatchrrFullChannel.model_validate(c) for c in raw_channels]
        groups = [DispatchrrChannelGroup(id=1, name="Sports", channel_count=len(channels))]
        with (
            patch(
                "app.services.dispatcharr.get_channel_groups",
                new=AsyncMock(return_value=groups),
            ),
            patch(
                "app.services.dispatcharr.get_channels_with_groups",
                new=AsyncMock(return_value=channels),
            ),
        ):
            return await _build_grouped_channels()

    @staticmethod
    def _guide_ids(response: GroupedChannelsResponse) -> dict[str, str]:
        channels = [c for g in response.groups for c in g.channels] + response.ungrouped
        return {c.name: c.guide_id for c in channels}

    @pytest.mark.asyncio
    async def test_guide_id_is_the_formatted_channel_number(self) -> None:
        """Guide ids match Dispatcharr's XMLTV channel ids, not its database ids."""
        response = await self._build(
            [
                {
                    "id": 101,
                    "name": "TSN 5",
                    "channel_number": 28,
                    "channel_group_id": 1,
                    "uuid": "uuid-28",
                },
                {
                    "id": 102,
                    "name": "CBC",
                    "channel_number": 7.0,
                    "channel_group_id": 1,
                    "uuid": "uuid-7",
                },
                {
                    "id": 103,
                    "name": "TVA",
                    "channel_number": 5.1,
                    "channel_group_id": None,
                    "uuid": "uuid-5-1",
                },
            ]
        )

        assert self._guide_ids(response) == {"TSN 5": "28", "CBC": "7", "TVA": "5.1"}

    @pytest.mark.asyncio
    async def test_renumbering_expires_the_guide(self) -> None:
        """A rebuild whose guide ids changed expires the cached XMLTV guide (D-03)."""
        guide = get_epg_service()
        guide._cache = {"28": []}
        guide._cache_expires = datetime.now(UTC) + timedelta(hours=1)
        channel = {"id": 101, "name": "TSN 5", "channel_group_id": 1, "uuid": "uuid-28"}

        await self._build([{**channel, "channel_number": 28}])
        await self._build([{**channel, "channel_number": 28}])
        assert guide._is_cache_valid() is True

        await self._build([{**channel, "channel_number": 29}])
        assert guide._is_cache_valid() is False

    @pytest.mark.asyncio
    async def test_guide_id_falls_back_to_database_id_without_a_number(self) -> None:
        """A channel with no number is keyed by its id, as Dispatcharr's XMLTV does."""
        response = await self._build(
            [
                {
                    "id": 42,
                    "name": "Unnumbered",
                    "channel_number": None,
                    "channel_group_id": 1,
                    "uuid": "uuid-42",
                }
            ]
        )

        assert self._guide_ids(response) == {"Unnumbered": "42"}

    @pytest.mark.asyncio
    async def test_logo_id_becomes_our_logo_route(self) -> None:
        """A channel's Dispatcharr logo id maps to our proxy route, exposed as logoUrl."""
        response = await self._build(
            [
                {
                    "id": 101,
                    "name": "TSN 5",
                    "channel_number": 28,
                    "channel_group_id": 1,
                    "uuid": "uuid-28",
                    "logo_id": 17,
                },
                {
                    "id": 102,
                    "name": "CBC",
                    "channel_number": 7,
                    "channel_group_id": None,
                    "uuid": "uuid-7",
                    "logo_id": None,
                },
            ]
        )

        channels = {c.name: c for g in response.groups for c in g.channels}
        channels.update({c.name: c for c in response.ungrouped})
        assert channels["TSN 5"].logo_url == "/api/channels/logos/17"
        assert channels["TSN 5"].model_dump(by_alias=True)["logoUrl"] == "/api/channels/logos/17"
        assert channels["CBC"].logo_url is None

    @pytest.mark.asyncio
    async def test_logo_url_is_never_taken_from_the_payload(self) -> None:
        """Only the integer logo id is read; URL-like fields in the payload are ignored."""
        response = await self._build(
            [
                {
                    "id": 101,
                    "name": "TSN 5",
                    "channel_number": 28,
                    "channel_group_id": 1,
                    "uuid": "uuid-28",
                    "logo_url": "http://evil.invalid/logo.png",
                    "logoUrl": "http://evil.invalid/logo.png",
                    "logo": "http://evil.invalid/logo.png",
                }
            ]
        )

        assert response.groups[0].channels[0].logo_url is None


GROUPS = [{"id": 1, "name": "Sports", "channel_count": 1}]
CHANNELS = [{"id": 101, "name": "TSN", "channel_number": 28, "channel_group_id": 1, "uuid": "u-28"}]


class TestGroupedChannelsOutage:
    """The grouped catalogue during a Dispatcharr outage (C-01)."""

    @pytest.fixture(autouse=True)
    def dispatcharr_settings(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(dispatcharr.settings, "dispatcharr_url", "http://dispatcharr.test")
        monkeypatch.setattr(dispatcharr.settings, "dispatcharr_api_key", "test-key")

    @pytest.fixture
    def clock(self, monkeypatch: pytest.MonkeyPatch) -> list[float]:
        now = [1000.0]
        monkeypatch.setattr("app.services.cached_fetch.monotonic", lambda: now[0])
        return now

    @staticmethod
    def _upstream(monkeypatch: pytest.MonkeyPatch, state: dict[str, Any]) -> list[httpx.Request]:
        """Serve GROUPS and state['channels'], or time out at connect while state['down']."""
        requests: list[httpx.Request] = []

        def handle(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            state["timeout"] = request.extensions["timeout"]
            if state["down"]:
                raise httpx.ConnectTimeout("timed out", request=request)
            if request.url.path == "/api/channels/groups/":
                return httpx.Response(200, json=GROUPS)
            return httpx.Response(200, json=state["channels"])

        mock_upstream(DISPATCHARR, handle)
        return requests

    @staticmethod
    def _names(response: GroupedChannelsResponse) -> list[str]:
        return [c.name for g in response.groups for c in g.channels]

    @staticmethod
    async def _background_refresh() -> None:
        task = dispatcharr._grouped_cache._task
        assert task is not None
        await task

    async def test_concurrent_callers_make_one_attempt_per_retry_window(
        self, monkeypatch: pytest.MonkeyPatch, clock: list[float]
    ) -> None:
        state: dict[str, Any] = {"down": True, "channels": CHANNELS}
        requests = self._upstream(monkeypatch, state)

        results = await asyncio.gather(
            *(dispatcharr.get_grouped_channels() for _ in range(10)), return_exceptions=True
        )

        assert all(isinstance(r, DispatchrrUnavailableError) for r in results)
        assert len(requests) == 2  # one groups and one channels call, not 20
        with pytest.raises(DispatchrrUnavailableError):
            await dispatcharr.get_grouped_channels()
        assert len(requests) == 2

        clock[0] += 20
        state["down"] = False
        assert self._names(await dispatcharr.get_grouped_channels()) == ["TSN"]
        assert len(requests) == 4

    async def test_stale_catalogue_is_served_until_upstream_recovers(
        self, monkeypatch: pytest.MonkeyPatch, clock: list[float]
    ) -> None:
        state: dict[str, Any] = {"down": False, "channels": CHANNELS}
        self._upstream(monkeypatch, state)
        assert self._names(await dispatcharr.get_grouped_channels()) == ["TSN"]

        # Expired, and the refresh fails: callers keep the last good catalogue
        clock[0] += 301
        state["down"] = True
        assert self._names(await dispatcharr.get_grouped_channels()) == ["TSN"]
        await self._background_refresh()
        assert self._names(await dispatcharr.get_grouped_channels()) == ["TSN"]

        # Upstream recovers: the next background refresh replaces it
        clock[0] += 20
        state["down"] = False
        state["channels"] = [{**CHANNELS[0], "name": "TSN 2"}]
        assert self._names(await dispatcharr.get_grouped_channels()) == ["TSN"]
        await self._background_refresh()
        assert self._names(await dispatcharr.get_grouped_channels()) == ["TSN 2"]

    async def test_catalogue_calls_fail_fast_at_connect(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        state: dict[str, Any] = {"down": False, "channels": CHANNELS}
        self._upstream(monkeypatch, state)

        await dispatcharr.get_grouped_channels()

        assert state["timeout"] == httpx.Timeout(10, connect=3).as_dict()
