"""Structured presence events (session.*, watch.*) emitted for log-based analytics."""

import json
from io import StringIO

import pytest
from loguru import logger

from app.services import presence


@pytest.fixture(autouse=True)
def reset_presence_state():
    presence._active_users.clear()
    yield
    presence._active_users.clear()


@pytest.fixture
def events():
    """Capture serialized log records and expose their extra fields."""
    output = StringIO()
    handler_id = logger.add(output, format="{message}", serialize=True, level="INFO")
    yield lambda: [
        json.loads(line)["record"]["extra"]
        for line in output.getvalue().splitlines()
        if "event" in json.loads(line)["record"]["extra"]
    ]
    logger.remove(handler_id)


def _names(records: list[dict]) -> list[str]:
    return [r["event"] for r in records]


def test_session_start_and_stop_carry_user_and_duration(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.remove_user("s1")

    recs = events()
    assert _names(recs) == ["session.start", "session.stop"]
    assert recs[0]["user"] == "jon" and recs[0]["session"] == "s1" and recs[0]["view"] == "live"
    assert recs[1]["reason"] == "disconnect"
    assert isinstance(recs[1]["duration_s"], float)


def test_channel_change_emits_watch_start_then_stop_with_channel_id(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", "Hockey", "live", channel_id="uuid-rds")
    presence.update_user_channel("s1", "TVA", "News", "live", channel_id="uuid-tva")

    recs = [r for r in events() if r["event"].startswith("watch.")]
    assert _names(recs) == ["watch.start", "watch.stop", "watch.start"]
    assert recs[0]["channel"] == "RDS"
    assert recs[0]["channel_id"] == "uuid-rds"
    assert recs[0]["programme"] == "Hockey"
    assert recs[1]["channel"] == "RDS" and recs[1]["reason"] == "switch"
    assert recs[1]["duration_s"] >= 0
    assert recs[2]["channel_id"] == "uuid-tva"


def test_programme_rollover_on_same_channel_emits_nothing(events) -> None:
    presence.track_user("s1", "jon", "ersatztv")
    presence.update_user_channel("s1", "Cinema", "First", "ersatztv", channel_id="C1")
    presence.update_user_channel("s1", "Cinema", "Second", "ersatztv", channel_id="C1")

    recs = [r for r in events() if r["event"].startswith("watch.")]
    assert _names(recs) == ["watch.start"]
    assert presence._active_users["s1"].current_programme == "Second"


def test_disconnect_while_watching_stops_watch_before_session(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", channel_id="uuid-rds")
    presence.remove_user("s1")

    recs = events()
    assert _names(recs) == ["session.start", "watch.start", "watch.stop", "session.stop"]
    assert recs[2]["reason"] == "disconnect" and recs[3]["reason"] == "disconnect"


def test_clearing_channel_emits_watch_stop_with_cleared_reason(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", channel_id="uuid-rds")
    presence.update_user_channel("s1", None)

    recs = [r for r in events() if r["event"].startswith("watch.")]
    assert _names(recs) == ["watch.start", "watch.stop"]
    assert recs[1]["reason"] == "cleared"
    assert presence._active_users["s1"].current_channel is None


def test_stale_cleanup_uses_stale_reason(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", channel_id="uuid-rds")
    presence.cleanup_stale_users(timeout_seconds=-1)

    recs = events()
    assert _names(recs)[-2:] == ["watch.stop", "session.stop"]
    assert {r["reason"] for r in recs[-2:]} == {"stale"}


def test_view_switch_on_same_session_closes_old_session(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", channel_id="uuid-rds")
    presence.track_user("s1", "jon", "ersatztv")

    recs = events()
    assert _names(recs) == [
        "session.start",
        "watch.start",
        "watch.stop",
        "session.stop",
        "session.start",
    ]
    assert recs[2]["reason"] == "view_switch" and recs[2]["view"] == "live"
    assert recs[4]["view"] == "ersatztv"
