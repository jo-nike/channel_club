"""Structured presence events (session.*, watch.*, programme.*) emitted for log-based analytics."""

import json
from datetime import UTC, datetime, timedelta
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


class _Clock:
    """A wall clock the test moves by hand."""

    def __init__(self) -> None:
        self.now = datetime(2026, 1, 1, tzinfo=UTC)

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


@pytest.fixture
def clock(monkeypatch):
    """Drive presence's wall clock (durations) from the test."""
    fake = _Clock()
    monkeypatch.setattr(presence, "_now", lambda: fake.now)
    return fake


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


def test_second_title_on_the_same_channel_stops_the_first_and_changes(events, clock) -> None:
    presence.track_user("s1", "jon", "ersatztv")
    presence.update_user_channel("s1", "Cinema", "First", "ersatztv", channel_id="C1")
    clock.advance(90)
    presence.update_user_channel("s1", "Cinema", "Second", "ersatztv", channel_id="C1")

    recs = [r for r in events() if r["event"] != "session.start"]
    assert _names(recs) == ["watch.start", "programme.stop", "programme.change"]
    stop, change = recs[1:]
    assert stop["programme"] == "First" and stop["duration_s"] == 90.0
    assert stop["channel"] == "Cinema" and stop["channel_id"] == "C1"
    assert change["programme"] == "Second" and "duration_s" not in change
    assert presence._active_users["s1"].current_programme == "Second"


def test_watch_stop_carries_the_last_programme(events) -> None:
    presence.track_user("s1", "jon", "ersatztv")
    presence.update_user_channel("s1", "Cinema", "First", "ersatztv", channel_id="C1")
    presence.update_user_channel("s1", "Cinema", "Second", "ersatztv", channel_id="C1")
    presence.update_user_channel("s1", "Other", None, "ersatztv", channel_id="C2")

    stops = [r for r in events() if r["event"] == "watch.stop"]
    assert [r["programme"] for r in stops] == ["Second"]


def test_watch_stop_closes_the_open_programme_first(events, clock) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", None, "live", channel_id="uuid-rds")
    clock.advance(10)
    presence.update_user_channel("s1", "RDS", "Hockey", "live", channel_id="uuid-rds")
    clock.advance(30)
    presence.remove_user("s1")

    recs = [r for r in events() if r["event"] not in ("session.start", "session.stop")]
    assert _names(recs) == ["watch.start", "programme.change", "programme.stop", "watch.stop"]
    assert recs[2]["programme"] == "Hockey" and recs[2]["duration_s"] == 30.0
    assert recs[3]["duration_s"] == 40.0


def test_null_titles_never_produce_programme_events(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", None, "live", channel_id="uuid-rds")
    presence.update_user_channel("s1", "RDS", None, "live", channel_id="uuid-rds")
    presence.update_user_channel("s1", "TVA", None, "live", channel_id="uuid-tva")
    presence.remove_user("s1")

    assert not [r for r in events() if r["event"].startswith("programme.")]


def test_titles_after_a_null_start_each_emit_programme_change(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", None, "live", channel_id="uuid-rds")
    presence.update_user_channel("s1", "RDS", "Hockey", "live", channel_id="uuid-rds")
    presence.update_user_channel("s1", "RDS", None, "live", channel_id="uuid-rds")
    presence.update_user_channel("s1", "RDS", "News", "live", channel_id="uuid-rds")

    recs = [r for r in events() if r["event"] != "session.start"]
    assert _names(recs) == [
        "watch.start",
        "programme.change",
        "programme.stop",
        "programme.change",
    ]
    assert recs[0]["programme"] is None
    assert recs[1]["programme"] == "Hockey"
    assert recs[1]["channel"] == "RDS" and recs[1]["channel_id"] == "uuid-rds"
    assert recs[2]["programme"] == "Hockey"
    assert recs[3]["programme"] == "News"


def test_watch_started_with_a_title_emits_no_programme_change(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", None, "Stray title", "live")
    presence.update_user_channel("s1", "RDS", "Hockey", "live", channel_id="uuid-rds")
    presence.update_user_channel("s1", "TVA", None, "live", channel_id="uuid-tva")
    presence.update_user_channel("s1", "TVA", "News", "live", channel_id="uuid-tva")

    recs = [r for r in events() if r["event"] != "session.start"]
    assert _names(recs) == [
        "watch.start",
        "programme.stop",
        "watch.stop",
        "watch.start",
        "programme.change",
    ]
    assert recs[1]["programme"] == "Hockey"
    assert recs[4]["programme"] == "News"


def test_stale_sweep_ends_watch_and_session_at_last_activity(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", channel_id="uuid-rds")
    user = presence._active_users["s1"]
    now = datetime.now(UTC)
    user.connected_since = now - timedelta(seconds=300)
    user.channel_since = now - timedelta(seconds=200)
    user.last_activity = now - timedelta(seconds=80)
    user.last_activity_mono -= 80

    presence.cleanup_stale_users(timeout_seconds=60)

    stop, session_stop = events()[-2:]
    assert stop["event"] == "watch.stop" and stop["duration_s"] == pytest.approx(120, abs=1)
    assert session_stop["event"] == "session.stop"
    assert session_stop["duration_s"] == pytest.approx(220, abs=1)


def test_stale_sweep_of_a_watch_started_after_the_last_ping_is_zero(events) -> None:
    presence.track_user("s1", "jon", "live")
    user = presence._active_users["s1"]
    user.last_activity = datetime.now(UTC) - timedelta(seconds=80)
    user.last_activity_mono -= 80
    presence.update_user_channel("s1", "RDS", channel_id="uuid-rds")

    presence.cleanup_stale_users(timeout_seconds=60)

    stop = next(r for r in events() if r["event"] == "watch.stop")
    assert stop["duration_s"] == 0.0


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
