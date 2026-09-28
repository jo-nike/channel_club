"""Tests for EPG service."""

import asyncio
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.models.channel import Channel
from app.models.epg import Program
from app.services.epg_service import EPGService, EPGServiceError, normalise_channel_name


class TestParseXmltvDatetime:
    """Tests for XMLTV datetime parsing."""

    def test_parse_standard_format(self) -> None:
        """Parse standard XMLTV datetime with timezone."""
        service = EPGService("http://test:9191")
        result = service._parse_xmltv_datetime("20260103200000 +0000")

        assert result.year == 2026
        assert result.month == 1
        assert result.day == 3
        assert result.hour == 20
        assert result.minute == 0
        assert result.second == 0

    def test_parse_with_positive_offset(self) -> None:
        """Parse datetime with positive timezone offset."""
        service = EPGService("http://test:9191")
        result = service._parse_xmltv_datetime("20260103200000 +0530")

        assert result.utcoffset() == timedelta(hours=5, minutes=30)

    def test_parse_with_negative_offset(self) -> None:
        """Parse datetime with negative timezone offset."""
        service = EPGService("http://test:9191")
        result = service._parse_xmltv_datetime("20260103200000 -0500")

        assert result.utcoffset() == timedelta(hours=-5)


class TestParseXmltv:
    """Tests for XMLTV XML parsing."""

    def test_parse_single_programme(self) -> None:
        """Parse XMLTV with single programme."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <channel id="uuid-abc123">
            <display-name>Test Channel</display-name>
          </channel>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="uuid-abc123">
            <title>Test Program</title>
            <desc>Test description</desc>
          </programme>
        </tv>
        """

        result, _ = service._parse_xmltv(xml_content)

        assert "uuid-abc123" in result
        assert len(result["uuid-abc123"]) == 1
        program = result["uuid-abc123"][0]
        assert program.title == "Test Program"
        assert program.description == "Test description"

    def test_parse_multiple_programmes(self) -> None:
        """Parse XMLTV with multiple programmes on same channel."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="uuid-abc123">
            <title>Program 1</title>
          </programme>
          <programme start="20260103210000 +0000" stop="20260103220000 +0000" channel="uuid-abc123">
            <title>Program 2</title>
          </programme>
        </tv>
        """

        result, _ = service._parse_xmltv(xml_content)

        assert len(result["uuid-abc123"]) == 2
        # Programs should be sorted by start time
        assert result["uuid-abc123"][0].title == "Program 1"
        assert result["uuid-abc123"][1].title == "Program 2"

    def test_parse_multiple_channels(self) -> None:
        """Parse XMLTV with programmes on different channels."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="channel-1">
            <title>Channel 1 Program</title>
          </programme>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="channel-2">
            <title>Channel 2 Program</title>
          </programme>
        </tv>
        """

        result, _ = service._parse_xmltv(xml_content)

        assert "channel-1" in result
        assert "channel-2" in result
        assert result["channel-1"][0].title == "Channel 1 Program"
        assert result["channel-2"][0].title == "Channel 2 Program"

    def test_parse_programme_without_description(self) -> None:
        """Parse programme with no description element."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="uuid-abc123">
            <title>Title Only</title>
          </programme>
        </tv>
        """

        result, _ = service._parse_xmltv(xml_content)

        assert result["uuid-abc123"][0].description is None

    def test_parse_empty_tv_element(self) -> None:
        """Parse empty TV element returns empty dict."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
        </tv>
        """

        result, _ = service._parse_xmltv(xml_content)

        assert result == {}

    def test_parse_invalid_xml_raises_error(self) -> None:
        """Invalid XML raises EPGServiceError."""
        service = EPGService("http://test:9191")

        with pytest.raises(EPGServiceError, match="Failed to parse XMLTV"):
            service._parse_xmltv("not valid xml")

    def test_parse_skips_programme_missing_channel(self) -> None:
        """Programmes without channel attribute are skipped."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000">
            <title>No Channel</title>
          </programme>
        </tv>
        """

        result, _ = service._parse_xmltv(xml_content)

        assert result == {}


class TestRefreshCache:
    """Tests for cache refresh functionality."""

    @pytest.mark.asyncio
    async def test_refresh_cache_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Successful cache refresh stores parsed data."""
        service = EPGService("http://test:9191")

        xml_response = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="uuid-abc123">
            <title>Test Program</title>
          </programme>
        </tv>
        """

        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, text=xml_response))
        )

        result = await service.refresh_cache()

        assert result is True
        assert "uuid-abc123" in service._cache
        assert service._cache_expires is not None

    @pytest.mark.asyncio
    async def test_refresh_cache_sets_24h_expiry(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Cache expiry is set to 24 hours from now."""
        service = EPGService("http://test:9191")

        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, text="<tv></tv>"))
        )

        before = datetime.now(UTC)
        await service.refresh_cache()
        after = datetime.now(UTC)

        expected_min = before + timedelta(hours=24)
        expected_max = after + timedelta(hours=24)
        assert service._cache_expires is not None
        assert expected_min <= service._cache_expires <= expected_max

    @pytest.mark.asyncio
    async def test_refresh_cache_connection_error_returns_false(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Connection error returns False without raising."""
        service = EPGService("http://test:9191")

        _patch_upstream(monkeypatch, _Upstream(_raise(httpx.ConnectError("Connection refused"))))

        result = await service.refresh_cache()

        assert result is False

    @pytest.mark.asyncio
    async def test_refresh_cache_timeout_returns_false(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Timeout returns False without raising."""
        service = EPGService("http://test:9191")

        _patch_upstream(monkeypatch, _Upstream(_raise(httpx.TimeoutException("Timeout"))))

        result = await service.refresh_cache()

        assert result is False

    @pytest.mark.asyncio
    async def test_refresh_cache_calls_correct_endpoint(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Refresh calls /output/epg endpoint."""
        service = EPGService("http://dispatcharr:9191")

        urls: list[str] = []

        def respond(request: httpx.Request) -> httpx.Response:
            urls.append(str(request.url))
            return httpx.Response(200, text="<tv></tv>")

        _patch_upstream(monkeypatch, _Upstream(respond))

        await service.refresh_cache()

        assert urls == ["http://dispatcharr:9191/output/epg"]


class TestGetNowPlaying:
    """Tests for get_now_playing functionality."""

    @pytest.mark.asyncio
    async def test_get_now_playing_with_current_program(self) -> None:
        """Returns current program when one is airing."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        programs = [
            Program(
                title="Current Show",
                start_time=now - timedelta(minutes=30),
                end_time=now + timedelta(minutes=30),
                description="Currently airing",
            ),
            Program(
                title="Next Show",
                start_time=now + timedelta(minutes=30),
                end_time=now + timedelta(hours=1, minutes=30),
            ),
        ]

        service._cache = {"channel-1": programs}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing("channel-1")

        assert result.channel_id == "channel-1"
        assert result.current_program is not None
        assert result.current_program.title == "Current Show"
        assert result.next_program is not None
        assert result.next_program.title == "Next Show"

    @pytest.mark.asyncio
    async def test_get_now_playing_no_current_program(self) -> None:
        """Returns next program when nothing is currently airing."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        programs = [
            Program(
                title="Upcoming Show",
                start_time=now + timedelta(hours=1),
                end_time=now + timedelta(hours=2),
            ),
        ]

        service._cache = {"channel-1": programs}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing("channel-1")

        assert result.current_program is None
        assert result.next_program is not None
        assert result.next_program.title == "Upcoming Show"

    @pytest.mark.asyncio
    async def test_get_now_playing_unknown_channel(self) -> None:
        """Returns null programs for unknown channel."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        service._cache = {}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing("unknown-channel")

        assert result.channel_id == "unknown-channel"
        assert result.current_program is None
        assert result.next_program is None

    @pytest.mark.asyncio
    async def test_get_now_playing_refreshes_stale_cache(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Refreshes cache when expired before returning data."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        # Set cache as expired
        service._cache = {}
        service._cache_expires = now - timedelta(hours=1)

        xml_response = f"""<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="{(now - timedelta(minutes=30)).strftime("%Y%m%d%H%M%S")} +0000"
                     stop="{(now + timedelta(minutes=30)).strftime("%Y%m%d%H%M%S")} +0000"
                     channel="channel-1">
            <title>Fresh Program</title>
          </programme>
        </tv>
        """

        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, text=xml_response))
        )

        result = await service.get_now_playing("channel-1")

        assert result.current_program is not None
        assert result.current_program.title == "Fresh Program"

    @pytest.mark.asyncio
    async def test_get_now_playing_uses_stale_cache_on_refresh_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Uses stale cache when refresh fails."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        stale_programs = [
            Program(
                title="Stale Program",
                start_time=now - timedelta(minutes=30),
                end_time=now + timedelta(minutes=30),
            ),
        ]

        # Set cache as expired but with data
        service._cache = {"channel-1": stale_programs}
        service._cache_expires = now - timedelta(hours=1)

        _patch_upstream(monkeypatch, _Upstream(_raise(httpx.ConnectError("Connection refused"))))

        result = await service.get_now_playing("channel-1")

        assert result.current_program is not None
        assert result.current_program.title == "Stale Program"

    @pytest.mark.asyncio
    async def test_get_now_playing_raises_when_no_cache_and_refresh_fails(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Raises error when refresh fails and no cache exists."""
        service = EPGService("http://test:9191")

        # No cache at all
        service._cache = {}
        service._cache_expires = None

        _patch_upstream(monkeypatch, _Upstream(_raise(httpx.ConnectError("Connection refused"))))

        with pytest.raises(EPGServiceError, match="EPG service unavailable"):
            await service.get_now_playing("channel-1")


def _on_air(title: str, now: datetime) -> list[Program]:
    return [
        Program(
            title=title,
            start_time=now - timedelta(minutes=30),
            end_time=now + timedelta(minutes=30),
        )
    ]


class TestChannelNameFallback:
    """Tests for matching a channel name to XMLTV display names when the guide id misses."""

    def test_normalise_channel_name_casefolds_and_collapses_whitespace(self) -> None:
        assert normalise_channel_name("  CA-S:\tTSN   5 ") == "ca-s: tsn 5"

    def test_parse_builds_display_name_map(self) -> None:
        """Every display name maps to its channel id; the first channel wins a shared name."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <channel id="28">
            <display-name>CA-S: TSN  5</display-name>
            <display-name>TSN5</display-name>
          </channel>
          <channel id="29">
            <display-name>ca-s: tsn 5</display-name>
            <display-name>Sportsnet</display-name>
          </channel>
          <channel>
            <display-name>No Id</display-name>
          </channel>
          <channel id="30">
            <display-name>   </display-name>
          </channel>
        </tv>
        """

        _, channel_names = service._parse_xmltv(xml_content)

        assert channel_names == {"ca-s: tsn 5": "28", "tsn5": "28", "sportsnet": "29"}

    @pytest.mark.asyncio
    async def test_name_fallback_returns_that_channels_programmes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A guide id missing from the feed resolves through the display name."""
        now = datetime.now(UTC)
        start = (now - timedelta(minutes=30)).strftime("%Y%m%d%H%M%S")
        stop = (now + timedelta(minutes=30)).strftime("%Y%m%d%H%M%S")
        later = (now + timedelta(minutes=90)).strftime("%Y%m%d%H%M%S")
        xml_response = f"""<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <channel id="tsn5.ca"><display-name>CA-S: TSN 5</display-name></channel>
          <channel id="cbc.ca"><display-name>CBC</display-name></channel>
          <programme start="{start} +0000" stop="{stop} +0000" channel="tsn5.ca">
            <title>Hockey Night</title>
          </programme>
          <programme start="{stop} +0000" stop="{later} +0000" channel="tsn5.ca">
            <title>Post-game</title>
          </programme>
          <programme start="{start} +0000" stop="{stop} +0000" channel="cbc.ca">
            <title>The National</title>
          </programme>
        </tv>
        """
        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, text=xml_response))
        )
        service = EPGService("http://dispatcharr.synthetic:9191")

        result = await service.get_now_playing("28", channel_name="CA-S: TSN 5")

        assert result.channel_id == "28"
        assert result.current_program is not None
        assert result.current_program.title == "Hockey Night"
        assert result.next_program is not None
        assert result.next_program.title == "Post-game"

    @pytest.mark.asyncio
    async def test_exact_guide_id_wins_over_name(self) -> None:
        """The name map is only consulted when the guide id has no programmes."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        service._cache = {"28": _on_air("By Id", now), "tsn5.ca": _on_air("By Name", now)}
        service._channel_names = {"ca-s: tsn 5": "tsn5.ca"}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing("28", channel_name="CA-S: TSN 5")

        assert result.current_program is not None
        assert result.current_program.title == "By Id"

    @pytest.mark.asyncio
    async def test_name_is_matched_after_normalisation(self) -> None:
        """Case and spacing differences between the catalogue and XMLTV still match."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        service._cache = {"tsn5.ca": _on_air("By Name", now)}
        service._channel_names = {"ca-s: tsn 5": "tsn5.ca"}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing("28", channel_name="  ca-s:  TSN 5 ")

        assert result.current_program is not None
        assert result.current_program.title == "By Name"

    @pytest.mark.asyncio
    async def test_unknown_name_or_no_name_returns_no_programmes(self) -> None:
        """Without a matching name, a missed guide id still returns empty."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        service._cache = {"tsn5.ca": _on_air("By Name", now)}
        service._channel_names = {"ca-s: tsn 5": "tsn5.ca"}
        service._cache_expires = now + timedelta(hours=1)

        unknown = await service.get_now_playing("28", channel_name="Some Other Channel")
        no_name = await service.get_now_playing("28")

        assert unknown.current_program is None
        assert unknown.next_program is None
        assert no_name.current_program is None
        assert no_name.next_program is None


class TestGetNowPlayingBulk:
    """Tests for get_now_playing_bulk functionality."""

    @pytest.mark.asyncio
    async def test_returns_on_air_program_per_channel(self) -> None:
        """Every channel with something airing is included."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        service._cache = {
            "channel-1": [
                Program(
                    title="Show One",
                    start_time=now - timedelta(minutes=30),
                    end_time=now + timedelta(minutes=30),
                ),
            ],
            "channel-2": [
                Program(
                    title="Show Two",
                    start_time=now - timedelta(minutes=10),
                    end_time=now + timedelta(minutes=50),
                ),
            ],
        }
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing_bulk()

        assert set(result) == {"channel-1", "channel-2"}
        assert result["channel-1"].title == "Show One"
        assert result["channel-2"].title == "Show Two"

    @pytest.mark.asyncio
    async def test_omits_channels_with_nothing_on_air(self) -> None:
        """Channels whose schedule has no current program are left out."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        service._cache = {
            "channel-1": [
                Program(
                    title="On Air",
                    start_time=now - timedelta(minutes=30),
                    end_time=now + timedelta(minutes=30),
                ),
            ],
            "channel-2": [
                Program(
                    title="Later Today",
                    start_time=now + timedelta(hours=2),
                    end_time=now + timedelta(hours=3),
                ),
            ],
            "channel-3": [],
        }
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing_bulk()

        assert set(result) == {"channel-1"}

    @pytest.mark.asyncio
    async def test_returns_empty_dict_for_empty_cache(self) -> None:
        """A valid but empty cache yields no results rather than an error."""
        service = EPGService("http://test:9191")

        service._cache = {}
        service._cache_expires = datetime.now(UTC) + timedelta(hours=1)

        assert await service.get_now_playing_bulk() == {}

    @pytest.mark.asyncio
    async def test_raises_when_no_cache_and_refresh_fails(self) -> None:
        """Propagates EPGServiceError like the single-channel lookup does."""
        service = EPGService("http://test:9191")

        service._cache = {}
        service._cache_expires = None

        with (
            patch.object(service, "refresh_cache", new=AsyncMock(return_value=False)),
            pytest.raises(EPGServiceError),
        ):
            await service.get_now_playing_bulk()


def _catalogue_channel(guide_id: str, name: str) -> Channel:
    return Channel(
        id=f"uuid-{guide_id}", name=name, stream_url="http://stream.test/x", guide_id=guide_id
    )


class TestGetNowPlayingBulkNameFallback:
    """Bulk lookups key catalogue channels by guide id, resolved like the single lookup."""

    @pytest.mark.asyncio
    async def test_guide_id_missing_from_feed_resolves_through_display_name(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A feed keyed by tvg_id still yields an entry under each channel's guide id."""
        now = datetime.now(UTC)
        start = (now - timedelta(minutes=30)).strftime("%Y%m%d%H%M%S")
        stop = (now + timedelta(minutes=30)).strftime("%Y%m%d%H%M%S")
        xml_response = f"""<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <channel id="tsn5.ca"><display-name>CA-S: TSN 5</display-name></channel>
          <channel id="cbc.ca"><display-name>CBC</display-name></channel>
          <programme start="{start} +0000" stop="{stop} +0000" channel="tsn5.ca">
            <title>Hockey Night</title>
          </programme>
          <programme start="{start} +0000" stop="{stop} +0000" channel="cbc.ca">
            <title>The National</title>
          </programme>
        </tv>
        """
        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, text=xml_response))
        )
        service = EPGService("http://dispatcharr.synthetic:9191")

        result = await service.get_now_playing_bulk(
            [
                _catalogue_channel("28", "ca-s:  tsn 5"),
                _catalogue_channel("29", "CBC"),
                _catalogue_channel("30", "Not In The Feed"),
            ]
        )

        assert result["28"].title == "Hockey Night"
        assert result["29"].title == "The National"
        assert "30" not in result
        # The XMLTV-keyed entries are still there, so the response shape is unchanged
        assert result["tsn5.ca"].title == "Hockey Night"

    @pytest.mark.asyncio
    async def test_exact_guide_id_wins_over_name(self) -> None:
        """The name map is only consulted when the guide id has no programmes."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        service._cache = {"28": _on_air("By Id", now), "tsn5.ca": _on_air("By Name", now)}
        service._channel_names = {"ca-s: tsn 5": "tsn5.ca"}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing_bulk([_catalogue_channel("28", "CA-S: TSN 5")])

        assert result["28"].title == "By Id"

    @pytest.mark.asyncio
    async def test_guide_id_with_nothing_on_air_does_not_fall_back(self) -> None:
        """Like the single lookup, a guide id with programmes is never replaced by a name match."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        service._cache = {
            "28": [
                Program(
                    title="Later",
                    start_time=now + timedelta(hours=2),
                    end_time=now + timedelta(hours=3),
                )
            ],
            "tsn5.ca": _on_air("By Name", now),
        }
        service._channel_names = {"ca-s: tsn 5": "tsn5.ca"}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing_bulk([_catalogue_channel("28", "CA-S: TSN 5")])

        assert "28" not in result

    @pytest.mark.asyncio
    async def test_name_match_with_nothing_on_air_is_omitted(self) -> None:
        """A matched XMLTV channel with nothing airing adds no entry."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        service._cache = {
            "tsn5.ca": [
                Program(
                    title="Later",
                    start_time=now + timedelta(hours=2),
                    end_time=now + timedelta(hours=3),
                )
            ]
        }
        service._channel_names = {"ca-s: tsn 5": "tsn5.ca"}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing_bulk([_catalogue_channel("28", "CA-S: TSN 5")])

        assert result == {}


def _programme(title: str, start: datetime, end: datetime) -> Program:
    return Program(title=title, start_time=start, end_time=end)


class TestGetProgrammes:
    """Tests for the schedule window of a single channel."""

    @pytest.mark.asyncio
    async def test_returns_programmes_inside_the_window_in_start_order(self) -> None:
        """Programmes ending after now-30min and starting before now+hours are returned."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        service._cache = {
            "28": [
                _programme("Ended 45m ago", now - timedelta(hours=2), now - timedelta(minutes=45)),
                _programme(
                    "Ended 10m ago", now - timedelta(minutes=45), now - timedelta(minutes=10)
                ),
                _programme("On now", now - timedelta(minutes=10), now + timedelta(minutes=50)),
                _programme(
                    "Later", now + timedelta(minutes=50), now + timedelta(hours=2, minutes=55)
                ),
                _programme(
                    "Just inside", now + timedelta(hours=2, minutes=55), now + timedelta(hours=4)
                ),
                _programme(
                    "Past the end", now + timedelta(hours=3, minutes=5), now + timedelta(hours=5)
                ),
            ]
        }
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_programmes("28", hours=3)

        assert result.channel_id == "28"
        assert [p.title for p in result.programmes] == [
            "Ended 10m ago",
            "On now",
            "Later",
            "Just inside",
        ]

    @pytest.mark.asyncio
    async def test_window_bounds_hold_for_programmes_in_other_timezones(self) -> None:
        """XMLTV offsets other than UTC are compared as instants, not wall-clock times."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        eastern = timezone(timedelta(hours=-5))
        service._cache = {
            "28": [
                _programme(
                    "On now",
                    (now - timedelta(minutes=10)).astimezone(eastern),
                    (now + timedelta(minutes=50)).astimezone(eastern),
                ),
                _programme(
                    "Tomorrow",
                    (now + timedelta(hours=20)).astimezone(eastern),
                    (now + timedelta(hours=21)).astimezone(eastern),
                ),
            ]
        }
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_programmes("28", hours=12)

        assert [p.title for p in result.programmes] == ["On now"]

    @pytest.mark.asyncio
    async def test_unknown_channel_returns_no_programmes(self) -> None:
        """A guide id with no data and no name is an empty schedule, not an error."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        service._cache = {"29": _on_air("Other Channel", now)}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_programmes("28", hours=12)

        assert result.channel_id == "28"
        assert result.programmes == []

    @pytest.mark.asyncio
    async def test_name_fallback_returns_that_channels_schedule(self) -> None:
        """A guide id missing from the feed resolves through the display name."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        service._cache = {
            "tsn5.ca": [
                _programme("Hockey Night", now - timedelta(minutes=30), now + timedelta(hours=1)),
                _programme("Post-game", now + timedelta(hours=1), now + timedelta(hours=2)),
            ],
            "cbc.ca": _on_air("The National", now),
        }
        service._channel_names = {"ca-s: tsn 5": "tsn5.ca", "cbc": "cbc.ca"}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_programmes("28", hours=12, channel_name="  CA-S:  TSN 5 ")

        assert result.channel_id == "28"
        assert [p.title for p in result.programmes] == ["Hockey Night", "Post-game"]

    @pytest.mark.asyncio
    async def test_exact_guide_id_wins_over_name(self) -> None:
        """The name map is only consulted when the guide id has no programmes."""
        service = EPGService("http://test:9191")
        now = datetime.now(UTC)
        service._cache = {"28": _on_air("By Id", now), "tsn5.ca": _on_air("By Name", now)}
        service._channel_names = {"ca-s: tsn 5": "tsn5.ca"}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_programmes("28", hours=12, channel_name="CA-S: TSN 5")

        assert [p.title for p in result.programmes] == ["By Id"]

    @pytest.mark.asyncio
    async def test_raises_when_no_cache_and_refresh_fails(self) -> None:
        """An empty cache with a failed refresh is an outage, reported as an error."""
        service = EPGService("http://test:9191")

        with (
            patch.object(service, "refresh_cache", new=AsyncMock(return_value=False)),
            pytest.raises(EPGServiceError),
        ):
            await service.get_programmes("28", hours=12)


class TestCacheValidity:
    """Tests for cache validity checking."""

    def test_cache_valid_when_not_expired(self) -> None:
        """Cache is valid when expiry is in the future."""
        service = EPGService("http://test:9191")
        service._cache_expires = datetime.now(UTC) + timedelta(hours=1)

        assert service._is_cache_valid() is True

    def test_cache_invalid_when_expired(self) -> None:
        """Cache is invalid when expiry is in the past."""
        service = EPGService("http://test:9191")
        service._cache_expires = datetime.now(UTC) - timedelta(hours=1)

        assert service._is_cache_valid() is False

    def test_cache_invalid_when_never_set(self) -> None:
        """Cache is invalid when never initialized."""
        service = EPGService("http://test:9191")

        assert service._is_cache_valid() is False


HEALTH_XMLTV = """<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="ch-a">
    <title>A1</title>
  </programme>
  <programme start="20260103210000 +0000" stop="20260103220000 +0000" channel="ch-a">
    <title>A2</title>
  </programme>
  <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="ch-b">
    <title>B1</title>
  </programme>
</tv>
"""


ENTITY_XMLTV = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv [<!ENTITY x "y">]>
<tv><channel id="ch-a"><display-name>&x;</display-name></channel></tv>
"""


def _raise(error: Exception) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    return handler


class _Upstream:
    """Mock XMLTV upstream that records how many requests reached it."""

    def __init__(self, handler: Callable[[httpx.Request], httpx.Response]) -> None:
        self.handler = handler
        self.requests = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests += 1
        return self.handler(request)


def _patch_upstream(monkeypatch: pytest.MonkeyPatch, upstream: _Upstream) -> None:
    factory = httpx.AsyncClient

    def client(**kwargs: Any) -> httpx.AsyncClient:
        return factory(transport=httpx.MockTransport(upstream), **kwargs)

    monkeypatch.setattr("app.services.epg_service.httpx.AsyncClient", client)


class TestHealth:
    """Tests for guide data health reporting."""

    @pytest.mark.asyncio
    async def test_health_after_403(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A refused XMLTV download reports the status code, not the URL."""
        upstream = _Upstream(lambda request: httpx.Response(403, text="Forbidden"))
        _patch_upstream(monkeypatch, upstream)
        service = EPGService("http://dispatcharr.synthetic:9191")

        before = datetime.now(UTC)
        health = await service.check_health()

        assert health.online is False
        assert health.stale is False
        assert health.error == "HTTP 403"
        assert health.channel_count == 0
        assert health.programme_count == 0
        assert health.last_success_at is None
        assert health.last_attempt_at is not None
        assert health.last_attempt_at >= before
        assert health.next_retry_at is not None
        assert health.next_retry_at - before >= timedelta(seconds=30)
        assert "dispatcharr.synthetic" not in health.model_dump_json()

    @pytest.mark.asyncio
    async def test_health_checks_wait_out_the_backoff(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Status polls during the backoff do not reach Dispatcharr."""
        upstream = _Upstream(lambda request: httpx.Response(403))
        _patch_upstream(monkeypatch, upstream)
        service = EPGService("http://dispatcharr.synthetic:9191")

        health = await service.check_health()
        for _ in range(2):
            health = await service.check_health()

        assert upstream.requests == 1
        assert health.error == "HTTP 403"

    @pytest.mark.asyncio
    async def test_health_after_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A successful refresh reports counts and when it succeeded."""
        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, text=HEALTH_XMLTV))
        )
        service = EPGService("http://dispatcharr.synthetic:9191")

        before = datetime.now(UTC)
        health = await service.check_health()

        assert health.online is True
        assert health.stale is False
        assert health.error is None
        assert health.channel_count == 2
        assert health.programme_count == 3
        assert health.last_success_at is not None
        assert health.last_success_at >= before
        assert health.next_retry_at is None
        dumped = health.model_dump(by_alias=True)
        assert dumped["channelCount"] == 2
        assert dumped["programmeCount"] == 3
        assert dumped["lastSuccessAt"] == health.last_success_at

    @pytest.mark.asyncio
    async def test_health_is_stale_when_refresh_fails_with_cached_data(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Expired guide data stays online but is flagged stale with the reason."""
        _patch_upstream(monkeypatch, _Upstream(lambda request: httpx.Response(403)))
        service = EPGService("http://dispatcharr.synthetic:9191")
        now = datetime.now(UTC)
        service._cache = {
            "ch-a": [Program(title="Old", start_time=now, end_time=now + timedelta(hours=1))]
        }
        service._cache_expires = now - timedelta(seconds=1)

        health = await service.check_health()

        assert health.online is True
        assert health.stale is True
        assert health.error == "HTTP 403"
        assert health.channel_count == 1
        assert health.programme_count == 1

    @pytest.mark.asyncio
    async def test_success_clears_previous_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Recovering from a failure clears the error and the retry deadline."""
        responses = iter([httpx.Response(403), httpx.Response(200, text=HEALTH_XMLTV)])
        _patch_upstream(monkeypatch, _Upstream(lambda request: next(responses)))
        service = EPGService("http://dispatcharr.synthetic:9191")

        assert (await service.check_health()).error == "HTTP 403"
        service._retry_at = datetime.now(UTC) - timedelta(seconds=1)
        health = await service.check_health()

        assert health.online is True
        assert health.error is None
        assert health.next_retry_at is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("handler", "reason"),
        [
            (_raise(httpx.ConnectError("refused")), "connection failed"),
            (_raise(httpx.ReadTimeout("slow")), "timeout"),
            (_raise(httpx.RemoteProtocolError("reset")), "request failed"),
            (lambda request: httpx.Response(200, text="<tv><broken"), "invalid XMLTV"),
            (lambda request: httpx.Response(200, text=ENTITY_XMLTV), "invalid XMLTV"),
        ],
    )
    async def test_health_reports_short_failure_reason(
        self,
        monkeypatch: pytest.MonkeyPatch,
        handler: Callable[[httpx.Request], httpx.Response],
        reason: str,
    ) -> None:
        """Each failure kind maps to a short reason without upstream details."""
        _patch_upstream(monkeypatch, _Upstream(handler))
        service = EPGService("http://dispatcharr.synthetic:9191")

        health = await service.check_health()

        assert health.online is False
        assert health.error == reason

    def test_get_health_does_not_refresh(self) -> None:
        """get_health reads local state only."""
        service = EPGService("http://dispatcharr.synthetic:9191")

        with patch.object(service, "refresh_cache", new=AsyncMock()) as refresh:
            health = service.get_health()

        refresh.assert_not_called()
        assert health.online is False
        assert health.last_attempt_at is None


class TestUnexpectedRefreshFailures:
    """Every refresh failure keeps the stale cache, the backoff and the health report (D-08)."""

    @pytest.mark.asyncio
    async def test_entity_declaration_serves_stale_data_and_backs_off(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        upstream = _Upstream(lambda request: httpx.Response(200, text=ENTITY_XMLTV))
        _patch_upstream(monkeypatch, upstream)
        service = EPGService("http://dispatcharr.synthetic:9191")
        now = datetime.now(UTC)
        service._cache = {"ch-a": _on_air("Stale Show", now)}
        service._cache_expires = now - timedelta(seconds=1)

        result = await service.get_now_playing("ch-a")

        assert result.current_program is not None
        assert result.current_program.title == "Stale Show"
        assert upstream.requests == 1
        assert service._retry_at is not None
        assert service.get_health().error == "invalid XMLTV"

    @pytest.mark.asyncio
    async def test_unexpected_error_is_a_failed_refresh(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, text=HEALTH_XMLTV))
        )
        service = EPGService("http://dispatcharr.synthetic:9191")

        with patch.object(service, "_parse_xmltv", side_effect=RuntimeError("bug")):
            assert await service.refresh_cache() is False

        assert service.get_health().error == "refresh failed"

    @pytest.mark.asyncio
    async def test_cancellation_is_not_swallowed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, text=HEALTH_XMLTV))
        )
        service = EPGService("http://dispatcharr.synthetic:9191")

        with (
            patch.object(service, "_parse_xmltv", side_effect=asyncio.CancelledError),
            pytest.raises(asyncio.CancelledError),
        ):
            await service.refresh_cache()


class _SlowBody(httpx.AsyncByteStream):
    """A body that sends one chunk, then stalls."""

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield b"<tv>"
        await asyncio.sleep(10)


class TestBoundedFeed:
    """The XMLTV download has a byte budget and a body deadline (D-07)."""

    @pytest.mark.asyncio
    async def test_oversized_feed_keeps_stale_cache_and_backs_off(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.services.epg_service.FEED_BYTES", 4 * 1024)
        oversized = HEALTH_XMLTV.encode() + b"<!-- pad -->" * 700  # about 8 KB
        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, content=oversized))
        )
        service = EPGService("http://dispatcharr.synthetic:9191")
        now = datetime.now(UTC)
        service._cache = {"ch-a": _on_air("Stale Show", now)}
        service._cache_expires = now - timedelta(seconds=1)

        result = await service.get_now_playing("ch-a")

        assert result.current_program is not None
        assert result.current_program.title == "Stale Show"
        assert service._retry_at is not None
        assert service.get_health().error == "feed too large"

    @pytest.mark.asyncio
    async def test_feed_is_decoded_by_its_xml_declaration(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        latin1 = (
            '<?xml version="1.0" encoding="ISO-8859-1"?>'
            '<tv><programme start="20260103200000 +0000" stop="20260103210000 +0000" '
            'channel="ch-a"><title>Caf\xe9</title></programme></tv>'
        ).encode("latin-1")
        _patch_upstream(monkeypatch, _Upstream(lambda request: httpx.Response(200, content=latin1)))
        service = EPGService("http://dispatcharr.synthetic:9191")

        assert await service.refresh_cache() is True
        assert service._cache["ch-a"][0].title == "Caf\xe9"

    @pytest.mark.asyncio
    async def test_stalled_body_times_out(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("app.services.bounded_http.BODY_SECONDS", 0.05)
        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, stream=_SlowBody()))
        )
        service = EPGService("http://dispatcharr.synthetic:9191")

        assert await service.refresh_cache() is False
        assert service.get_health().error == "timeout"
