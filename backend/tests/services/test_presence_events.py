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


def test_watch_events_carry_whether_the_viewer_follows_the_live_slot(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", "Hockey", "live", "uuid-rds", on_live=True)
    presence.update_user_channel("s1", "RDS", "Hockey", "live", "uuid-rds", on_live=True)
    # A personal pick of the same channel is a new watch
    presence.update_user_channel("s1", "RDS", "Hockey", "live", "uuid-rds", on_live=False)

    recs = [r for r in events() if r["event"].startswith("watch.")]
    assert [(r["event"], r["on_live"]) for r in recs] == [
        ("watch.start", True),
        ("watch.stop", True),
        ("watch.start", False),
    ]
    assert presence._active_users["s1"].on_live is False


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


def test_stale_sweep_ends_watch_and_session_at_last_activity(events, clock) -> None:
    presence.track_user("s1", "jon", "live")
    clock.advance(100)
    presence.update_user_channel("s1", "RDS", channel_id="uuid-rds")
    clock.advance(120)
    presence.update_last_activity("s1")
    clock.advance(80)
    presence._active_users["s1"].last_activity_mono -= 80

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


def _watch_events(records: list[dict]) -> list[dict]:
    return [r for r in records if r["event"].startswith(("watch.", "programme."))]


def test_two_connections_of_one_person_on_one_channel_are_one_watch(events, clock) -> None:
    presence.track_user("s1", "jon", "live", user_id="u1")
    presence.track_user("s2", "jon", "live", user_id="u1")
    presence.update_user_channel("s1", "RDS", "Hockey", "live", "uuid-rds")
    presence.update_user_channel("s2", "RDS", "Hockey", "live", "uuid-rds")
    clock.advance(3600)
    presence.remove_user("s1")
    presence.remove_user("s2")

    recs = _watch_events(events())
    assert _names(recs) == ["watch.start", "programme.stop", "watch.stop"]
    start, stop = recs[0], recs[2]
    assert stop["duration_s"] == 3600.0
    assert start["session"] == stop["session"] == "s1"
    assert start["user_id"] == stop["user_id"] == "u1"


def test_closing_a_non_primary_connection_emits_only_its_session_stop(events, clock) -> None:
    presence.track_user("s1", "jon", "live", user_id="u1")
    presence.track_user("s2", "jon", "live", user_id="u1")
    presence.update_user_channel("s1", "RDS", "Hockey", "live", "uuid-rds")
    clock.advance(10)
    presence.update_user_channel("s2", "RDS", "Hockey", "live", "uuid-rds")
    before = len(events())

    presence.remove_user("s1")

    after = events()[before:]
    assert _names(after) == ["session.stop"]
    assert after[0]["session"] == "s1" and after[0]["user_id"] == "u1"


def test_primary_leaving_on_a_shared_channel_keeps_the_watch_open(events, clock) -> None:
    presence.track_user("s1", "jon", "live", user_id="u1")
    presence.track_user("s2", "jon", "live", user_id="u1")
    presence.update_user_channel("s1", "RDS", "Hockey", "live", "uuid-rds")
    presence.update_user_channel("s2", "RDS", "Hockey", "live", "uuid-rds")
    clock.advance(1800)
    before = len(events())
    presence.remove_user("s1")  # The primary, found first on a tie
    assert _names(events()[before:]) == ["session.stop"]

    clock.advance(1800)
    presence.remove_user("s2")

    stop = next(r for r in events() if r["event"] == "watch.stop")
    assert stop["duration_s"] == 3600.0 and stop["session"] == "s1"


def test_primary_leaving_moves_the_watch_to_the_other_connections_channel(events, clock) -> None:
    presence.track_user("s1", "jon", "live", user_id="u1")
    presence.track_user("s2", "jon", "live", user_id="u1")
    presence.update_user_channel("s2", "TVA", None, "live", "uuid-tva")
    clock.advance(10)
    presence.update_user_channel("s1", "RDS", None, "live", "uuid-rds")
    before = len(events())

    presence.remove_user("s1")

    recs = _watch_events(events()[before:])
    assert [(r["event"], r["channel_id"]) for r in recs] == [
        ("watch.stop", "uuid-rds"),
        ("watch.start", "uuid-tva"),
    ]
    assert recs[1]["session"] == "s2"


def test_second_connection_tuning_elsewhere_is_one_person_level_switch(events, clock) -> None:
    presence.track_user("s1", "jon", "live", user_id="u1")
    presence.track_user("s2", "jon", "live", user_id="u1")
    presence.update_user_channel("s1", "RDS", "Hockey", "live", "uuid-rds")
    presence.update_user_channel("s2", "RDS", "Hockey", "live", "uuid-rds")
    clock.advance(60)
    presence.update_user_channel("s2", "TVA", "News", "live", "uuid-tva")
    clock.advance(60)
    # The first connection is no longer the primary: its titles count for nothing
    presence.update_user_channel("s1", "RDS", "Hockey, second period", "live", "uuid-rds")

    recs = [r for r in _watch_events(events()) if r["event"] != "programme.stop"]
    assert [(r["event"], r["channel_id"], r.get("reason")) for r in recs] == [
        ("watch.start", "uuid-rds", "start"),
        ("watch.stop", "uuid-rds", "switch"),
        ("watch.start", "uuid-tva", "switch"),
    ]


def test_two_people_on_one_channel_keep_two_watches(events) -> None:
    presence.track_user("s1", "jon", "live", user_id="u1")
    presence.track_user("s2", "amy", "live", user_id="u2")
    presence.update_user_channel("s1", "RDS", None, "live", "uuid-rds")
    presence.update_user_channel("s2", "RDS", None, "live", "uuid-rds")
    presence.remove_user("s1")

    recs = _watch_events(events())
    assert [(r["event"], r["user_id"]) for r in recs] == [
        ("watch.start", "u1"),
        ("watch.start", "u2"),
        ("watch.stop", "u1"),
    ]


def test_a_persons_first_watch_starts_with_reason_start(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", None, "live", "uuid-rds")

    (start,) = [r for r in events() if r["event"] == "watch.start"]
    assert start["reason"] == "start"


def test_moving_with_the_live_slot_is_a_live_follow(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", None, "live", "uuid-rds", on_live=True)
    presence.update_user_channel("s1", "TVA", None, "live", "uuid-tva", on_live=True)

    recs = _watch_events(events())
    assert [(r["event"], r["reason"]) for r in recs] == [
        ("watch.start", "start"),
        ("watch.stop", "live_follow"),
        ("watch.start", "live_follow"),
    ]


def test_leaving_the_live_slot_for_another_channel_is_a_switch(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", None, "live", "uuid-rds", on_live=True)
    presence.update_user_channel("s1", "TVA", None, "live", "uuid-tva", on_live=False)

    recs = _watch_events(events())
    assert [r["reason"] for r in recs[1:]] == ["switch", "switch"]


def test_a_pre_r2_client_without_on_live_still_logs_switch(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", None, "live", "uuid-rds")
    presence.update_user_channel("s1", "TVA", None, "live", "uuid-tva")

    recs = _watch_events(events())
    assert [r["reason"] for r in recs[1:]] == ["switch", "switch"]


def test_remove_user_passes_its_reason_to_session_and_watch_stop(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", None, "live", "uuid-rds")
    presence.remove_user("s1", reason="server_restart")

    recs = events()
    assert [(r["event"], r["reason"]) for r in recs[-2:]] == [
        ("watch.stop", "server_restart"),
        ("session.stop", "server_restart"),
    ]


def test_watch_progress_and_stop_deltas_add_up_to_the_watch(
    events, clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(presence, "WATCH_PROGRESS_SECONDS", 300)
    presence.track_user("s1", "jon", "live", user_id="u1")
    presence.update_user_channel("s1", "RDS", None, "live", "uuid-rds", on_live=True)
    # The cleanup loop's 30 s passes over a 12-minute watch
    for _ in range(24):
        clock.advance(30)
        presence.record_watch_progress()
    presence.remove_user("s1")

    recs = [r for r in events() if r["event"] in ("watch.progress", "watch.stop")]
    progress, stop = recs[:-1], recs[-1]
    assert [r["delta_s"] for r in progress] == [300.0, 300.0]
    assert progress[0]["user_id"] == "u1" and progress[0]["session"] == "s1"
    assert progress[0]["channel_id"] == "uuid-rds" and progress[0]["on_live"] is True
    assert progress[0]["view"] == "live" and progress[0]["channel"] == "RDS"
    assert stop["delta_s"] == 120.0 and stop["duration_s"] == 720.0
    assert sum(r["delta_s"] for r in recs) == pytest.approx(stop["duration_s"], abs=0.1)


def test_no_watch_progress_without_an_open_watch(events, clock) -> None:
    presence.track_user("s1", "jon", "live")
    clock.advance(presence.WATCH_PROGRESS_SECONDS * 2)
    presence.record_watch_progress()
    presence.update_user_channel("s1", "RDS", None, "live", "uuid-rds")
    presence.update_user_channel("s1", None)
    clock.advance(presence.WATCH_PROGRESS_SECONDS * 2)
    presence.record_watch_progress()

    assert not [r for r in events() if r["event"] == "watch.progress"]


def test_a_stale_end_before_the_last_progress_never_logs_a_negative_delta(events, clock) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "RDS", None, "live", "uuid-rds")
    clock.advance(100)
    presence.update_last_activity("s1")
    clock.advance(presence.WATCH_PROGRESS_SECONDS)
    presence.record_watch_progress()
    presence._active_users["s1"].last_activity_mono -= presence.WATCH_PROGRESS_SECONDS

    presence.cleanup_stale_users(timeout_seconds=60)

    stop = next(r for r in events() if r["event"] == "watch.stop")
    assert stop["delta_s"] == 0.0 and stop["duration_s"] == 100.0


def test_a_new_name_for_the_same_channel_id_renames_the_watch(events) -> None:
    presence.track_user("s1", "jon", "live")
    presence.update_user_channel("s1", "rds hd", None, "live", "uuid-rds", channel_known=None)
    presence.update_user_channel(
        "s1", "RDS", None, "live", "uuid-rds", channel_known=True, claimed_channel="rds hd"
    )
    presence.remove_user("s1")

    recs = _watch_events(events())
    assert _names(recs) == ["watch.start", "watch.stop"]
    assert recs[0]["channel"] == "rds hd" and recs[0]["channel_known"] is None
    assert "claimed_channel" not in recs[0]
    assert recs[1]["channel"] == "RDS" and recs[1]["channel_known"] is True
    assert recs[1]["claimed_channel"] == "rds hd"
