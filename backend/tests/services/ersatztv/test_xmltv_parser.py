"""Tests for XMLTV parser service.

Story: 7.3 - XMLTV Parser Service
Tests datetime parsing, programme extraction, caching, and error handling.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

# Will import after implementation
# from app.services.ersatztv.xmltv_parser import (
#     parse_xmltv,
#     clear_cache,
#     _parse_xmltv_datetime,
#     _parse_xmltv_content,
# )


SAMPLE_XMLTV = """<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="comedy-classics">
    <display-name>Comedy Classics</display-name>
  </channel>
  <programme start="20260103180000 +0000" stop="20260103200000 +0000" channel="comedy-classics">
    <title>Airplane!</title>
    <desc>Classic comedy film from 1980</desc>
    <category>Comedy</category>
    <category>Movie</category>
  </programme>
  <programme start="20260103200000 +0000" stop="20260103220000 +0000" channel="comedy-classics">
    <title>The Naked Gun</title>
    <desc>Leslie Nielsen comedy classic</desc>
    <category>Comedy</category>
  </programme>
</tv>
"""

SAMPLE_XMLTV_MINIMAL = """<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <programme start="20260103180000 +0000" stop="20260103200000 +0000" channel="ch1">
    <title>Test Movie</title>
  </programme>
</tv>
"""

SAMPLE_XMLTV_WITH_TIMEZONE = """<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <programme start="20260103180000 -0500" stop="20260103200000 -0500" channel="ch1">
    <title>EST Show</title>
  </programme>
  <programme start="20260103180000 +0530" stop="20260103200000 +0530" channel="ch2">
    <title>IST Show</title>
  </programme>
</tv>
"""


class TestParseXmltvDatetime:
    """Tests for XMLTV datetime parsing."""

    def test_parse_utc_datetime(self):
        """Parses UTC datetime correctly."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_datetime

        result = _parse_xmltv_datetime("20260103180000 +0000")

        assert result.tzinfo == UTC
        assert result.year == 2026
        assert result.month == 1
        assert result.day == 3
        assert result.hour == 18
        assert result.minute == 0
        assert result.second == 0

    def test_parse_negative_offset_converts_to_utc(self):
        """Converts negative timezone offset to UTC."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_datetime

        # 18:00 EST (-0500) = 23:00 UTC
        result = _parse_xmltv_datetime("20260103180000 -0500")

        assert result.tzinfo == UTC
        assert result.hour == 23
        assert result.day == 3

    def test_parse_positive_offset_converts_to_utc(self):
        """Converts positive timezone offset to UTC."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_datetime

        # 18:00 IST (+0530) = 12:30 UTC
        result = _parse_xmltv_datetime("20260103180000 +0530")

        assert result.tzinfo == UTC
        assert result.hour == 12
        assert result.minute == 30

    def test_parse_datetime_with_day_rollover(self):
        """Handles timezone conversion that crosses day boundary."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_datetime

        # 02:00 -0500 = 07:00 UTC same day
        result = _parse_xmltv_datetime("20260103020000 -0500")
        assert result.hour == 7
        assert result.day == 3

        # 23:00 +0500 = 18:00 UTC same day
        result2 = _parse_xmltv_datetime("20260103230000 +0500")
        assert result2.hour == 18
        assert result2.day == 3

    def test_parse_invalid_datetime_format_raises(self):
        """Raises ValueError for invalid datetime format."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_datetime

        with pytest.raises(ValueError, match="Invalid XMLTV datetime"):
            _parse_xmltv_datetime("invalid")

        with pytest.raises(ValueError, match="Invalid XMLTV datetime"):
            _parse_xmltv_datetime("20260103180000")  # Missing timezone

    def test_parse_invalid_timezone_raises(self):
        """Raises ValueError for invalid timezone format."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_datetime

        with pytest.raises(ValueError, match="Invalid timezone"):
            _parse_xmltv_datetime("20260103180000 0000")  # Missing +/-


class TestParseXmltvContent:
    """Tests for XMLTV content parsing."""

    def test_extracts_programme_attributes(self):
        """Extracts all programme attributes from XMLTV."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_content

        programmes = _parse_xmltv_content(SAMPLE_XMLTV)

        assert len(programmes) == 2

        prog1 = programmes[0]
        assert prog1.channel_id == "comedy-classics"
        assert prog1.title == "Airplane!"
        assert prog1.description == "Classic comedy film from 1980"
        assert prog1.category == ["Comedy", "Movie"]
        assert prog1.start.tzinfo == UTC
        assert prog1.stop.tzinfo == UTC

    def test_generates_unique_programme_id(self):
        """Generates programme ID from channel_id + start timestamp."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_content

        programmes = _parse_xmltv_content(SAMPLE_XMLTV)

        prog1 = programmes[0]
        # ID should be channel_id_timestamp
        assert prog1.id.startswith("comedy-classics_")
        assert "_" in prog1.id

    def test_handles_missing_optional_fields(self):
        """Handles programmes with missing description and category."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_content

        programmes = _parse_xmltv_content(SAMPLE_XMLTV_MINIMAL)

        assert len(programmes) == 1
        assert programmes[0].title == "Test Movie"
        assert programmes[0].description is None
        assert programmes[0].category is None

    def test_converts_all_timezones_to_utc(self):
        """Converts all programme times to UTC."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_content

        programmes = _parse_xmltv_content(SAMPLE_XMLTV_WITH_TIMEZONE)

        # All should be UTC
        for prog in programmes:
            assert prog.start.tzinfo == UTC
            assert prog.stop.tzinfo == UTC

        # EST show: 18:00 -0500 = 23:00 UTC
        est_show = [p for p in programmes if p.title == "EST Show"][0]
        assert est_show.start.hour == 23

        # IST show: 18:00 +0530 = 12:30 UTC
        ist_show = [p for p in programmes if p.title == "IST Show"][0]
        assert ist_show.start.hour == 12
        assert ist_show.start.minute == 30

    def test_skips_programmes_without_required_fields(self):
        """Skips programmes missing required fields."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_content

        xmltv_missing_title = """<?xml version="1.0"?>
<tv>
  <programme start="20260103180000 +0000" stop="20260103200000 +0000" channel="ch1">
    <desc>No title here</desc>
  </programme>
  <programme start="20260103180000 +0000" stop="20260103200000 +0000" channel="ch2">
    <title>Valid</title>
  </programme>
</tv>
"""
        programmes = _parse_xmltv_content(xmltv_missing_title)

        # Should only have the valid programme
        assert len(programmes) == 1
        assert programmes[0].title == "Valid"


class TestParseXmltvCache:
    """Tests for XMLTV caching behavior."""

    def test_returns_cached_data_within_ttl(self):
        """Returns cached data without re-fetching if within 5 minutes."""
        from app.services.ersatztv import xmltv_parser

        # Reset cache
        xmltv_parser.clear_cache()

        with patch.object(xmltv_parser.httpx, "get") as mock_get:
            mock_response = MagicMock()
            mock_response.text = SAMPLE_XMLTV
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            # First call - should fetch
            result1 = xmltv_parser.parse_xmltv()
            assert mock_get.call_count == 1

            # Second call - should use cache
            result2 = xmltv_parser.parse_xmltv()
            assert mock_get.call_count == 1  # Still 1, no new fetch

            assert len(result1) == len(result2)

    def test_refetches_after_cache_expires(self):
        """Refetches data after cache expires (5 minutes)."""
        from app.services.ersatztv import xmltv_parser

        # Reset cache
        xmltv_parser.clear_cache()

        with patch.object(xmltv_parser.httpx, "get") as mock_get:
            mock_response = MagicMock()
            mock_response.text = SAMPLE_XMLTV
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            # First call
            xmltv_parser.parse_xmltv()
            assert mock_get.call_count == 1

            # Simulate cache expiry by setting timestamp in the past
            xmltv_parser._cache["timestamp"] = datetime.now() - timedelta(minutes=6)

            # Second call - should refetch
            xmltv_parser.parse_xmltv()
            assert mock_get.call_count == 2

    def test_clear_cache_forces_refetch(self):
        """clear_cache() forces next call to fetch."""
        from app.services.ersatztv import xmltv_parser

        xmltv_parser.clear_cache()

        with patch.object(xmltv_parser.httpx, "get") as mock_get:
            mock_response = MagicMock()
            mock_response.text = SAMPLE_XMLTV
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            xmltv_parser.parse_xmltv()
            assert mock_get.call_count == 1

            # Clear cache
            xmltv_parser.clear_cache()

            # Should fetch again
            xmltv_parser.parse_xmltv()
            assert mock_get.call_count == 2


class TestParseXmltvErrorHandling:
    """Tests for error handling behavior."""

    def test_returns_stale_cache_on_fetch_failure(self):
        """Returns stale cached data when fetch fails."""
        from app.services.ersatztv import xmltv_parser

        xmltv_parser.clear_cache()

        with patch.object(xmltv_parser.httpx, "get") as mock_get:
            # First call succeeds
            mock_response = MagicMock()
            mock_response.text = SAMPLE_XMLTV
            mock_response.raise_for_status = MagicMock()
            mock_get.return_value = mock_response

            result1 = xmltv_parser.parse_xmltv()
            assert len(result1) == 2

            # Expire cache
            xmltv_parser._cache["timestamp"] = datetime.now() - timedelta(minutes=6)

            # Second call fails
            mock_get.side_effect = Exception("Network error")

            # Should return stale cache
            result2 = xmltv_parser.parse_xmltv()
            assert len(result2) == 2

    def test_raises_when_no_cache_and_fetch_fails(self):
        """Raises exception when fetch fails and no cache available."""
        from app.services.ersatztv import xmltv_parser

        xmltv_parser.clear_cache()
        # Also clear last_successful_fetch
        xmltv_parser._cache["last_successful_fetch"] = None

        with patch.object(xmltv_parser.httpx, "get") as mock_get:
            mock_get.side_effect = Exception("Network error")

            with pytest.raises(Exception, match="Failed to load EPG"):
                xmltv_parser.parse_xmltv()
