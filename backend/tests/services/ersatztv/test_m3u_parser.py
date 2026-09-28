"""Tests for ErsatzTV M3U parser service.

Story: 7.2 - M3U Parser Service
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.models.ersatztv import EPGChannel
from app.services.ersatztv.m3u_parser import (
    CACHE_TTL_SECONDS,
    _cache,
    _is_cache_expired,
    _parse_m3u_content,
    clear_cache,
    parse_m3u_playlist,
)
from app.services.ersatztv.refresh import FeedUnavailableError

# fmt: off
# ruff: noqa: E501
SAMPLE_M3U = """#EXTM3U
#EXTINF:-1 tvg-id="ch1" tvg-name="Channel 1" tvg-chno="1" tvg-logo="http://logo.png" group-title="Movies",Channel 1
http://example.com/stream1.m3u8
#EXTINF:-1 tvg-id="ch2" tvg-name="Channel 2" tvg-chno="2",Channel 2
http://example.com/stream2.m3u8
"""
# fmt: on

SAMPLE_M3U_WITH_DUPLICATES = """#EXTM3U
#EXTINF:-1 tvg-id="ch1" tvg-name="Channel 1" tvg-chno="1",Channel 1
http://example.com/stream1.m3u8
#EXTINF:-1 tvg-id="ch1" tvg-name="Channel 1 Duplicate" tvg-chno="2",Channel 1 Duplicate
http://example.com/stream2.m3u8
"""

SAMPLE_M3U_CHANNEL_ID = """#EXTM3U
#EXTINF:-1 channel-id="C1.145.ersatztv.org" tvg-name="Comedy Classics" tvg-chno="1" tvg-logo="http://192.168.50.108:8409/artwork/logo.png" group-title="Comedy",Comedy Classics
http://192.168.50.108:8409/iptv/channel/1.m3u8
"""

SAMPLE_M3U_NO_TVG_NAME = """#EXTM3U
#EXTINF:-1 tvg-id="ch1" tvg-chno="1",Fallback Name
http://example.com/stream1.m3u8
"""


class TestParseM3UContent:
    """Tests for _parse_m3u_content internal function (AC: #1)."""

    def test_extracts_all_channels(self):
        """Parser extracts all channels from M3U."""
        channels = _parse_m3u_content(SAMPLE_M3U)
        assert len(channels) == 2

    def test_extracts_channel_id(self):
        """Parser extracts tvg-id as channel id."""
        channels = _parse_m3u_content(SAMPLE_M3U)
        assert channels[0].id == "ch1"
        assert channels[1].id == "ch2"

    def test_extracts_channel_name(self):
        """Parser extracts tvg-name as channel name."""
        channels = _parse_m3u_content(SAMPLE_M3U)
        assert channels[0].name == "Channel 1"
        assert channels[1].name == "Channel 2"

    def test_extracts_channel_number(self):
        """Parser extracts tvg-chno as channel number."""
        channels = _parse_m3u_content(SAMPLE_M3U)
        assert channels[0].number == 1
        assert channels[1].number == 2

    def test_keeps_decimal_channel_numbers(self):
        """A decimal tvg-chno stays a float, a whole one stays an int, anything else is None."""
        content = """#EXTM3U
#EXTINF:-1 tvg-id="a" tvg-chno="2.1",A
http://example.com/a.m3u8
#EXTINF:-1 tvg-id="b" tvg-chno="7",B
http://example.com/b.m3u8
#EXTINF:-1 tvg-id="c" channel-number="4.20",C
http://example.com/c.m3u8
#EXTINF:-1 tvg-id="d" tvg-chno="2.1.1",D
http://example.com/d.m3u8
"""
        channels = _parse_m3u_content(content)
        assert channels[0].number == 2.1
        assert isinstance(channels[0].number, float)
        assert channels[1].number == 7
        assert isinstance(channels[1].number, int)
        assert channels[2].number == 4.2
        assert channels[3].number is None

    def test_extracts_stream_url(self):
        """Parser extracts stream URL from next line."""
        channels = _parse_m3u_content(SAMPLE_M3U)
        assert channels[0].stream_url == "http://example.com/stream1.m3u8"
        assert channels[1].stream_url == "http://example.com/stream2.m3u8"

    def test_extracts_logo_url(self):
        """Parser extracts tvg-logo as logo URL."""
        channels = _parse_m3u_content(SAMPLE_M3U)
        assert channels[0].logo_url == "http://logo.png"
        assert channels[1].logo_url is None

    def test_extracts_group(self):
        """Parser extracts group-title as group."""
        channels = _parse_m3u_content(SAMPLE_M3U)
        assert channels[0].group == "Movies"
        assert channels[1].group is None

    def test_handles_duplicate_ids(self):
        """Parser handles duplicate tvg-id by appending suffix."""
        channels = _parse_m3u_content(SAMPLE_M3U_WITH_DUPLICATES)
        assert len(channels) == 2
        assert channels[0].id == "ch1"
        assert channels[1].id == "ch1_2"  # Appended suffix for duplicate

    def test_uses_channel_id_when_no_tvg_id(self):
        """Parser falls back to channel-id when tvg-id is missing."""
        channels = _parse_m3u_content(SAMPLE_M3U_CHANNEL_ID)
        assert len(channels) == 1
        assert channels[0].id == "C1.145.ersatztv.org"

    def test_extracts_name_from_comma_fallback(self):
        """Parser extracts name from comma fallback when tvg-name missing."""
        channels = _parse_m3u_content(SAMPLE_M3U_NO_TVG_NAME)
        # tvg-name is missing so should fall back to comma-separated name
        assert channels[0].name == "Fallback Name"

    def test_returns_epg_channel_instances(self):
        """Parser returns list of EPGChannel instances."""
        channels = _parse_m3u_content(SAMPLE_M3U)
        assert all(isinstance(ch, EPGChannel) for ch in channels)

    def test_empty_m3u_returns_empty_list(self):
        """Parser returns empty list for empty M3U content."""
        channels = _parse_m3u_content("#EXTM3U\n")
        assert channels == []


class TestCacheBehavior:
    """Tests for caching functionality (AC: #2)."""

    def setup_method(self):
        """Reset cache before each test."""
        clear_cache()

    def test_cache_is_expired_when_empty(self):
        """Cache reports expired when timestamp is None."""
        _cache["timestamp"] = None
        assert _is_cache_expired() is True

    def test_cache_is_fresh_within_ttl(self):
        """Cache reports fresh when within 1 hour TTL."""
        _cache["timestamp"] = datetime.now()
        assert _is_cache_expired() is False

    def test_cache_is_expired_after_ttl(self):
        """Cache reports expired when older than 1 hour."""
        _cache["timestamp"] = datetime.now() - timedelta(seconds=CACHE_TTL_SECONDS + 1)
        assert _is_cache_expired() is True

    @patch("app.services.ersatztv.m3u_parser.fetch_feed")
    def test_returns_cached_data_within_ttl(self, mock_get: MagicMock):
        """Cache returns cached data without refetching within TTL."""
        mock_response = MagicMock()
        mock_response.text = SAMPLE_M3U
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        # First call fetches and caches
        channels1 = parse_m3u_playlist()
        assert mock_get.call_count == 1

        # Second call returns cache without HTTP request
        channels2 = parse_m3u_playlist()
        assert mock_get.call_count == 1  # Still just 1 call
        assert len(channels1) == len(channels2)

    @patch("app.services.ersatztv.m3u_parser.fetch_feed")
    def test_refetches_after_cache_expires(self, mock_get: MagicMock):
        """Cache refetches data after TTL expires."""
        mock_response = MagicMock()
        mock_response.text = SAMPLE_M3U
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        # First call fetches and caches
        parse_m3u_playlist()
        assert mock_get.call_count == 1

        # Expire cache manually
        _cache["timestamp"] = datetime.now() - timedelta(seconds=CACHE_TTL_SECONDS + 1)

        # Second call should refetch
        parse_m3u_playlist()
        assert mock_get.call_count == 2

    def test_clear_cache_resets_timestamp(self):
        """clear_cache() resets cache timestamp."""
        _cache["timestamp"] = datetime.now()
        _cache["channels"] = [MagicMock()]

        clear_cache()

        assert _cache["timestamp"] is None


class TestGracefulFallback:
    """Tests for graceful fallback behavior (AC: #3)."""

    def setup_method(self):
        """Reset cache before each test."""
        clear_cache()

    @patch("app.services.ersatztv.m3u_parser.fetch_feed")
    def test_returns_stale_cache_on_network_error(self, mock_get: MagicMock):
        """Returns stale cached data if network fails."""
        # First call succeeds
        mock_response = MagicMock()
        mock_response.text = SAMPLE_M3U
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        channels1 = parse_m3u_playlist()
        assert len(channels1) == 2

        # Expire cache
        _cache["timestamp"] = datetime.now() - timedelta(seconds=CACHE_TTL_SECONDS + 1)

        # Second call fails with network error
        mock_get.side_effect = httpx.RequestError("Network error", request=MagicMock())

        # Should return stale cached data
        channels2 = parse_m3u_playlist()
        assert len(channels2) == 2  # Same as cached

    @patch("app.services.ersatztv.m3u_parser.fetch_feed")
    def test_raises_exception_when_no_cache_available(self, mock_get: MagicMock):
        """Raises exception if fetch fails and no cache exists."""
        # Ensure cache is completely clean (including last_successful_fetch)
        _cache["timestamp"] = None
        _cache["channels"] = []
        _cache["last_successful_fetch"] = None

        mock_get.side_effect = httpx.RequestError("Network error", request=MagicMock())

        with pytest.raises(Exception) as exc_info:
            parse_m3u_playlist()

        assert "Failed to load channels from ErsatzTV" in str(exc_info.value)

    @patch("app.services.ersatztv.m3u_parser.fetch_feed")
    def test_returns_stale_cache_on_http_error(self, mock_get: MagicMock):
        """Returns stale cached data on HTTP status errors."""
        # First call succeeds
        mock_response = MagicMock()
        mock_response.text = SAMPLE_M3U
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        channels1 = parse_m3u_playlist()

        # Expire cache
        _cache["timestamp"] = datetime.now() - timedelta(seconds=CACHE_TTL_SECONDS + 1)

        # Second call gets HTTP error
        mock_get.side_effect = httpx.HTTPStatusError(
            "503 Service Unavailable", request=MagicMock(), response=MagicMock()
        )

        # Should return stale cached data
        channels2 = parse_m3u_playlist()
        assert len(channels2) == len(channels1)

    @patch("app.services.ersatztv.m3u_parser.fetch_feed")
    def test_oversized_playlist_reports_the_guides_reason(self, mock_get: MagicMock):
        """The M3U's failure reasons use the same wording as both XMLTV guides."""
        mock_get.side_effect = ValueError("Feed exceeds byte/time budget")

        with pytest.raises(FeedUnavailableError):
            parse_m3u_playlist()

        assert parse_m3u_playlist.last_error == "feed too large"


class TestIntegration:
    """Integration tests for parse_m3u_playlist."""

    def setup_method(self):
        """Reset cache before each test."""
        clear_cache()

    @patch("app.services.ersatztv.m3u_parser.fetch_feed")
    def test_full_parsing_workflow(self, mock_get: MagicMock):
        """Full workflow: fetch, parse, cache, return EPGChannel list."""
        mock_response = MagicMock()
        mock_response.text = SAMPLE_M3U
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        channels = parse_m3u_playlist()

        assert len(channels) == 2
        assert channels[0].id == "ch1"
        assert channels[0].name == "Channel 1"
        assert channels[0].stream_url == "http://example.com/stream1.m3u8"
        assert channels[0].logo_url == "http://logo.png"
        assert channels[0].number == 1
        assert channels[0].group == "Movies"
