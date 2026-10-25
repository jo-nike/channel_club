"""Tests for XMLTV parser service.

Story: 7.3 - XMLTV Parser Service
Tests datetime parsing, programme extraction, caching, and error handling.
"""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.services.http_clients import ERSATZTV
from tests.http_helpers import mock_upstream

# Will import after implementation
# from app.services.ersatztv.xmltv_parser import (
#     parse_xmltv,
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

    def test_missing_offset_means_utc(self):
        """The shared XMLTV parser reads a timestamp with no offset as +0000."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_datetime

        result = _parse_xmltv_datetime("20260103180000")

        assert result == datetime(2026, 1, 3, 18, 0, tzinfo=UTC)

    def test_parse_invalid_datetime_raises(self):
        """Raises ValueError for a timestamp that isn't one."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_datetime

        with pytest.raises(ValueError):
            _parse_xmltv_datetime("invalid")


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
        """Skips programmes missing a channel, start or stop."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_content

        xmltv_missing_channel = """<?xml version="1.0"?>
<tv>
  <programme start="20260103180000 +0000" stop="20260103200000 +0000">
    <title>No channel</title>
  </programme>
  <programme start="20260103180000 +0000" channel="ch1">
    <title>No stop</title>
  </programme>
  <programme start="20260103180000 +0000" stop="20260103200000 +0000" channel="ch2">
    <title>Valid</title>
  </programme>
</tv>
"""
        programmes = _parse_xmltv_content(xmltv_missing_channel)

        assert [p.title for p in programmes] == ["Valid"]

    def test_keeps_untitled_programmes_as_unknown(self):
        """A programme with no title stays in the guide as 'Unknown', as in Dispatcharr's."""
        from app.services.ersatztv.xmltv_parser import _parse_xmltv_content

        xmltv_missing_title = """<?xml version="1.0"?>
<tv>
  <programme start="20260103180000 +0000" stop="20260103200000 +0000" channel="ch1">
    <desc>No title here</desc>
  </programme>
  <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="ch1">
    <title></title>
  </programme>
</tv>
"""
        programmes = _parse_xmltv_content(xmltv_missing_title)

        assert [p.title for p in programmes] == ["Unknown", "Unknown"]
        assert programmes[0].description == "No title here"


def _serve(monkeypatch: pytest.MonkeyPatch, handler) -> list[httpx.Request]:
    """Answer the guide's XMLTV fetches with handler; returns the requests made."""
    requests: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    mock_upstream(ERSATZTV, upstream)
    return requests


def _ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, text=SAMPLE_XMLTV)


class TestParseXmltvCache:
    """Tests for XMLTV caching behavior."""

    async def test_returns_cached_data_within_ttl(self, monkeypatch: pytest.MonkeyPatch):
        """Returns cached data without re-fetching if within 5 minutes."""
        from app.services.ersatztv.xmltv_parser import guide

        requests = _serve(monkeypatch, _ok)

        result1 = await guide.programmes("comedy-classics")
        result2 = await guide.programmes("comedy-classics")

        assert len(requests) == 1
        assert [p.title for p in result1] == ["Airplane!", "The Naked Gun"]
        assert result2 == result1

    async def test_fetch_is_bounded_and_does_not_follow_redirects(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """The feed fetch keeps fetch_feed's limits: no redirects, 2 s timeouts."""
        from app.services.ersatztv.xmltv_parser import guide

        requests = _serve(
            monkeypatch,
            lambda request: httpx.Response(302, headers={"location": "http://elsewhere/"}),
        )

        health = await guide.ensure_fresh()

        assert len(requests) == 1
        assert health.error == "HTTP 302"
        assert requests[0].extensions["timeout"] == {
            "connect": 2,
            "read": 2,
            "write": 2,
            "pool": 2,
        }

    async def test_refetches_after_cache_expires(self, monkeypatch: pytest.MonkeyPatch):
        """An expired guide is served stale while one background refresh fetches it."""
        from app.services.ersatztv.xmltv_parser import guide

        requests = _serve(monkeypatch, _ok)
        await guide.programmes("comedy-classics")

        guide._cache_expires = datetime.now(UTC) - timedelta(seconds=1)
        await guide.programmes("comedy-classics")
        assert guide._refresh_task is not None
        await guide._refresh_task

        assert len(requests) == 2


class TestParseXmltvErrorHandling:
    """Tests for error handling behavior."""

    async def test_returns_stale_cache_on_fetch_failure(self, monkeypatch: pytest.MonkeyPatch):
        """Returns stale cached data when fetch fails."""
        from app.services.ersatztv.xmltv_parser import guide

        responses = iter([httpx.Response(200, text=SAMPLE_XMLTV), httpx.Response(500)])
        _serve(monkeypatch, lambda request: next(responses))
        result1 = await guide.programmes("comedy-classics")

        guide._cache_expires = datetime.now(UTC) - timedelta(seconds=1)
        result2 = await guide.programmes("comedy-classics")
        assert guide._refresh_task is not None
        await guide._refresh_task

        assert result2 == result1
        assert await guide.programmes("comedy-classics") == result1
        assert guide.get_health().error == "HTTP 500"

    async def test_raises_when_no_cache_and_fetch_fails(self, monkeypatch: pytest.MonkeyPatch):
        """Raises when fetch fails and no cache available."""
        from app.services.ersatztv.refresh import FeedUnavailableError
        from app.services.ersatztv.xmltv_parser import guide

        _serve(monkeypatch, lambda request: httpx.Response(500))

        with pytest.raises(FeedUnavailableError, match="Failed to load EPG"):
            await guide.programmes("comedy-classics")
