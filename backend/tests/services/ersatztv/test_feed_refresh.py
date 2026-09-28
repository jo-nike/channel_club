"""ErsatzTV feed reads never wait on a refresh when data is cached, and back off (N-01, D-04)."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from io import StringIO
from unittest.mock import MagicMock, patch

import httpx
import pytest
from loguru import logger

from app.services.ersatztv import refresh, xmltv_parser
from app.services.ersatztv.refresh import FeedUnavailableError

XMLTV = """<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <programme start="20260103180000 +0000" stop="20260103200000 +0000" channel="ch1">
    <title>Show</title>
  </programme>
</tv>
"""


def _ok(_url: str) -> MagicMock:
    response = MagicMock()
    response.text = XMLTV
    return response


def _expire() -> None:
    xmltv_parser._cache["timestamp"] = datetime.now() - timedelta(minutes=6)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    now = [1000.0]
    monkeypatch.setattr(refresh, "monotonic", lambda: now[0])
    return now


def test_readers_get_stale_data_at_once_while_a_refresh_hangs() -> None:
    entered, release = threading.Event(), threading.Event()

    def hang(_url: str) -> MagicMock:
        entered.set()
        assert release.wait(5)
        return _ok(_url)

    with patch.object(xmltv_parser, "fetch_feed", side_effect=_ok):
        stale = xmltv_parser.parse_xmltv()
    _expire()

    with (
        patch.object(xmltv_parser, "fetch_feed", side_effect=hang),
        ThreadPoolExecutor(max_workers=11) as pool,
    ):
        refresher = pool.submit(xmltv_parser.parse_xmltv)
        try:
            assert entered.wait(2)
            started = time.monotonic()
            readers = [pool.submit(xmltv_parser.parse_xmltv) for _ in range(10)]
            results = [reader.result(timeout=1) for reader in readers]
            elapsed = time.monotonic() - started
        finally:
            release.set()
        refresher.result(timeout=2)

    assert elapsed < 0.1
    assert all(result is stale for result in results)


def test_failed_refreshes_back_off_30_60_120_seconds(clock: list[float]) -> None:
    with patch.object(xmltv_parser, "fetch_feed", side_effect=_ok):
        stale = xmltv_parser.parse_xmltv()
    _expire()

    attempts: list[float] = []

    def down(_url: str) -> MagicMock:
        attempts.append(clock[0])
        raise httpx.ConnectError("refused")

    with patch.object(xmltv_parser, "fetch_feed", side_effect=down):
        for _ in range(600):  # one read a second for ten minutes
            assert xmltv_parser.parse_xmltv() is stale
            clock[0] += 1

    assert [t - 1000 for t in attempts] == [0, 30, 90, 210, 450]


def test_cold_failure_answers_fast_until_the_backoff_ends(clock: list[float]) -> None:
    fetch = MagicMock(side_effect=httpx.ConnectError("refused"))
    with patch.object(xmltv_parser, "fetch_feed", fetch):
        for _ in range(3):
            with pytest.raises(FeedUnavailableError, match="Failed to load EPG"):
                xmltv_parser.parse_xmltv()
        assert fetch.call_count == 1

        clock[0] += 30
        with pytest.raises(FeedUnavailableError):
            xmltv_parser.parse_xmltv()
        assert fetch.call_count == 2


def test_first_failure_of_an_outage_is_an_error_and_repeats_are_debug(
    clock: list[float],
) -> None:
    with patch.object(xmltv_parser, "fetch_feed", side_effect=_ok):
        xmltv_parser.parse_xmltv()
    _expire()

    output = StringIO()
    sink = logger.add(output, level="DEBUG", format="{level}|{message}")
    try:
        with patch.object(xmltv_parser, "fetch_feed", side_effect=httpx.ConnectError("refused")):
            for _ in range(3):
                xmltv_parser.parse_xmltv()
                clock[0] += 300
    finally:
        logger.remove(sink)

    failures = [line for line in output.getvalue().splitlines() if "Failed to refresh" in line]
    assert [line.split("|", 1)[0] for line in failures] == ["ERROR", "DEBUG", "DEBUG"]
    assert "serving stale data, next retry in 30s" in failures[0]


def test_health_reports_a_stale_guide_and_the_next_retry(clock: list[float]) -> None:
    health = xmltv_parser.get_health()
    assert not health.online
    assert health.programme_count == 0

    with patch.object(xmltv_parser, "fetch_feed", side_effect=_ok):
        xmltv_parser.parse_xmltv()
    health = xmltv_parser.get_health()
    assert health.online and not health.stale
    assert (health.channel_count, health.programme_count) == (1, 1)
    assert health.last_success_at is not None
    assert health.error is None and health.next_retry_at is None

    _expire()
    with patch.object(xmltv_parser, "fetch_feed", side_effect=httpx.ConnectError("refused")):
        xmltv_parser.parse_xmltv()
    health = xmltv_parser.get_health()
    assert health.online and health.stale
    assert health.error == "connection failed"
    assert health.next_retry_at is not None

    with patch.object(xmltv_parser, "fetch_feed", side_effect=_ok):
        clock[0] += 30
        xmltv_parser.parse_xmltv()
    health = xmltv_parser.get_health()
    assert not health.stale and health.error is None and health.next_retry_at is None


def test_clear_cache_forgets_the_backoff(clock: list[float]) -> None:
    fetch = MagicMock(side_effect=httpx.ConnectError("refused"))
    with patch.object(xmltv_parser, "fetch_feed", fetch):
        with pytest.raises(FeedUnavailableError):
            xmltv_parser.parse_xmltv()
        xmltv_parser.clear_cache()
        with pytest.raises(FeedUnavailableError):
            xmltv_parser.parse_xmltv()
    assert fetch.call_count == 2
