"""The analytics events and the Grafana dashboard that reads them agree.

Events are loguru records with an "event" extra, written as JSON lines by the
production sink. Loki's `| json` flattens them to record_extra_<field>, which is
what every dashboard query filters and aggregates on.
"""

import importlib.util
import json
import logging
import re
import sys
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from loguru import logger

from app.config import Settings
from app.logging_config import configure_logging
from app.main import app
from app.models.channel import Channel
from app.routers import websocket as websocket_router
from app.services import channel_state, presence
from app.services.auth import create_access_token
from tests.ws_helpers import ws_connect

GENERATOR = Path(__file__).parents[2] / "ops" / "grafana" / "generate-channel-club-dashboard.py"

STDLIB_LOGGERS = ["", "uvicorn", "uvicorn.error", "uvicorn.access", "fastapi", "httpx", "httpcore"]


@pytest.fixture
def production_logging() -> Iterator[Callable[..., StringIO]]:
    """Run the real configure_logging into a buffer, then restore logging state."""
    saved = {
        name: (lg.handlers[:], lg.level, lg.propagate, lg.filters[:])
        for name in STDLIB_LOGGERS
        for lg in [logging.getLogger(name)]
    }

    def configure(log_format: str = "json", log_level: str = "INFO") -> StringIO:
        output = StringIO()
        config = Settings(_env_file=None, log_format=log_format, log_level=log_level)
        with patch("app.logging_config.settings", config), patch.object(sys, "stderr", output):
            configure_logging()
        return output

    yield configure
    logger.remove()
    for name, (handlers, level, propagate, filters) in saved.items():
        lg = logging.getLogger(name)
        lg.handlers, lg.propagate, lg.filters = handlers, propagate, filters
        lg.setLevel(level)


def _events(output: StringIO) -> list[dict]:
    records = [json.loads(line)["record"] for line in output.getvalue().splitlines()]
    return [r["extra"] for r in records if "event" in r["extra"]]


def test_events_survive_a_warning_log_level(production_logging) -> None:
    output = production_logging(log_level="WARNING")
    logger.info("ordinary info line")
    logger.bind(event="watch.start", user="jon").info("started")

    lines = output.getvalue().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["record"]["extra"] == {"event": "watch.start", "user": "jon"}


def test_events_are_written_once_at_info(production_logging) -> None:
    output = production_logging(log_level="INFO")
    logger.info("ordinary info line")
    logger.bind(event="watch.start", user="jon").info("started")

    messages = [json.loads(line)["record"]["message"] for line in output.getvalue().splitlines()]
    assert messages == ["ordinary info line", "started"]


def test_event_sink_redacts_like_the_main_sink(production_logging) -> None:
    output = production_logging(log_level="WARNING")
    logger.bind(event="watch.start", token="SYNTHETIC_SECRET").info("started")

    assert "SYNTHETIC_SECRET" not in output.getvalue()
    assert _events(output) == [{"event": "watch.start", "token": "[REDACTED]"}]


@pytest.mark.parametrize("log_level", ["WARNING", "INFO"])
def test_pretty_format_writes_each_event_once(production_logging, log_level) -> None:
    output = production_logging(log_format="pretty", log_level=log_level)
    logger.bind(event="watch.start").info("started watching")

    assert output.getvalue().count("started watching") == 1


def _load_generator():
    """Import the dashboard generator; importing it writes nothing."""
    spec = importlib.util.spec_from_file_location("channel_club_dashboard", GENERATOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_committed_dashboard_matches_the_generator(tmp_path) -> None:
    output = tmp_path / "channel-club.json"
    _load_generator().main(output)

    assert (
        output.read_bytes() == (GENERATOR.parent / "dashboards" / "channel-club.json").read_bytes()
    )


def _exprs(node) -> list[str]:
    if isinstance(node, dict):
        own = [node["expr"]] if isinstance(node.get("expr"), str) else []
        return own + [e for value in node.values() for e in _exprs(value)]
    if isinstance(node, list):
        return [e for value in node for e in _exprs(value)]
    return []


# An event filter: one event, or a regex alternation of them ("a|b")
_EVENT_FILTER = re.compile(r'record_extra_event=~?"([^"]+)"')
_FIELD = re.compile(r"record_extra_(\w+)")
# A Go template `or` in label_format: the first of its arguments that is set
_TEMPLATE_OR = re.compile(r"\{\{\s*or\s+([^}]*)\}\}")


def _filtered_events(text: str) -> list[str]:
    return [event for found in _EVENT_FILTER.findall(text) for event in found.split("|")]


def _queries_of(prefix: str) -> list[str]:
    """The dashboard's Loki queries that filter on an event starting with prefix."""
    exprs = _exprs(_load_generator().dashboard)
    return [e for e in exprs if any(ev.startswith(prefix) for ev in _filtered_events(e))]


def test_watch_queries_leave_out_the_pre_r2_empty_live_slot() -> None:
    watch = _queries_of("watch.")
    assert watch
    for expr in watch:
        assert 'record_extra_channel_id!="live-channel-0"' in expr, expr


def test_no_session_query_filters_on_view() -> None:
    # Session events carry no view: every client connects as the unified TV view
    session = _queries_of("session.")
    assert session
    for expr in session:
        assert "record_extra_view" not in expr, expr


def test_watch_time_accrues_from_progress_and_stop_deltas() -> None:
    # Every summed duration is watch time, read from delta_s as it accrues, with
    # a pre-R3 watch.stop's whole duration_s where it has no delta_s
    sums = [e for e in _exprs(_load_generator().dashboard) if "unwrap" in e]
    assert len(sums) == 5
    for expr in sums:
        assert 'record_extra_event=~"watch.progress|watch.stop"' in expr, expr
        assert "{{ or .record_extra_delta_s .record_extra_duration_s }}" in expr, expr
        assert "unwrap watch_s" in expr, expr


def _required_fields(
    node, required: dict[str, set[tuple[str, ...]]]
) -> dict[str, set[tuple[str, ...]]]:
    """Map each event a Loki query filters on to the record_extra fields it reads.

    A query's text is its dict's string values together (expr with its legend,
    a variable's stream with its label), so an event_table's label_format
    columns and a bargauge's legend count as fields of that event. Each entry
    is a group of which an event must carry one: a single field, or the
    fields of a template `or`, which needs none when it ends in a literal.
    """
    if isinstance(node, dict):
        text = " ".join(value for value in node.values() if isinstance(value, str))
        plain = _TEMPLATE_OR.sub("", text)
        fields = {(field,) for field in _FIELD.findall(plain) if field != "event"}
        for args in _TEMPLATE_OR.findall(text):
            if '"' not in args:
                fields.add(tuple(_FIELD.findall(args)))
        for event in _filtered_events(plain):
            required.setdefault(event, set()).update(fields)
        for value in node.values():
            _required_fields(value, required)
    elif isinstance(node, list):
        for value in node:
            _required_fields(value, required)
    return required


def _loki_flatten(value, prefix: str = "") -> dict[str, object]:
    """Flatten a JSON line the way Loki's `| json` does: nested keys joined by '_'.

    Nulls are dropped: a null gives the dashboard nothing to group or filter on.
    """
    if isinstance(value, dict):
        flat: dict[str, object] = {}
        for key, item in value.items():
            flat.update(_loki_flatten(item, f"{prefix}_{key}" if prefix else key))
        return flat
    return {} if value is None else {prefix: value}


def _emitted(output: StringIO) -> list[dict[str, object]]:
    lines = [_loki_flatten(json.loads(line)) for line in output.getvalue().splitlines()]
    return [line for line in lines if "record_extra_event" in line]


def _settle(ws) -> None:
    """Round-trip a ping so every message sent before it has been handled."""
    ws.send_json({"type": "ping"})
    while ws.receive_json()["type"] != "pong":
        pass


def _update(channel: str, channel_id: str, programme: str, on_live: bool) -> dict:
    return {
        "type": "channel_update",
        "channel": channel,
        "channelId": channel_id,
        "programme": programme,
        "view": "live",
        "onLive": on_live,
    }


@contextmanager
def _app_client() -> Iterator[TestClient]:
    with (
        patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
        TestClient(app) as client,
    ):
        yield client


@pytest.fixture
def client() -> Iterator[TestClient]:
    with _app_client() as client:
        yield client


def test_every_event_the_dashboard_reads_carries_its_fields(
    production_logging, monkeypatch: pytest.MonkeyPatch
) -> None:
    required = _required_fields(_load_generator().dashboard, {})
    assert {
        "session.start",
        "watch.start",
        "watch.stop",
        "programme.stop",
        "channel.change",
        "watch.progress",
    } <= required.keys()
    output = production_logging(log_format="json", log_level="WARNING")
    # Apply the channel updates at once instead of holding each for a second
    monkeypatch.setattr(websocket_router, "CHANNEL_UPDATE_INTERVAL_SECONDS", 0)
    # Every open watch is due its watch.progress at once
    monkeypatch.setattr(presence, "WATCH_PROGRESS_SECONDS", 0)
    token = create_access_token({"sub": "jon", "role": "admin"})

    # Started after the logging, so its server.start is captured
    with _app_client() as client:
        with ws_connect(client, token, view="live", session_id="s1") as ws:
            ws.receive_json()  # connection_ack
            ws.send_json(_update("RDS", "uuid-rds", "Hockey", on_live=True))
            # The Live slot moves to TVA and the viewer follows it
            ws.send_json(_update("TVA", "uuid-tva", "News", on_live=True))
            _settle(ws)
            client.portal.call(presence.record_watch_progress)
            ws.send_json(_update("CBC", "uuid-cbc", "Movie", on_live=False))
            _settle(ws)
            ws.close(code=1012)  # What uvicorn sends every socket on shutdown
        channel = Channel(
            id="uuid-rds", name="RDS", streamUrl="https://streams.example/rds", guideId="1"
        )
        client.portal.call(channel_state.set_current_channel, channel, "jon")

    lines = _emitted(output)
    for event, fields in sorted(required.items()):
        emitted = [line for line in lines if line["record_extra_event"] == event]
        assert emitted, f"{event} was never emitted"
        for line in emitted:
            missing = {
                " or ".join(group)
                for group in fields
                if not any(f"record_extra_{f}" in line for f in group)
            }
            assert not missing, f"{event} lacks {sorted(missing)} that the dashboard reads"
    stops = [
        (line["record_extra_channel"], line["record_extra_reason"])
        for line in lines
        if line["record_extra_event"] == "watch.stop"
    ]
    assert stops == [("RDS", "live_follow"), ("TVA", "switch"), ("CBC", "server_restart")]
    assert any(line["record_extra_event"] == "watch.progress" for line in lines)
    assert any(line["record_extra_event"] == "server.start" for line in lines)


def test_reconnect_stops_each_watch_once(production_logging, client) -> None:
    output = production_logging(log_format="json", log_level="INFO")
    token = create_access_token({"sub": "jon", "role": "viewer"})
    update = {"type": "channel_update", "channel": "RDS", "channelId": "uuid-rds", "view": "live"}

    with ws_connect(client, token, view="live", session_id="s1") as old:
        old.receive_json()
        old.send_json(update)
        _settle(old)
        # The reloaded tab's socket registers before the old one's close arrives
        with ws_connect(client, token, view="live", session_id="s1") as new:
            new.receive_json()
            new.send_json(update)
            _settle(new)
            old.close()
            _settle(new)

    events = [line["record_extra_event"] for line in _emitted(output)]
    assert events.count("watch.start") == events.count("watch.stop") >= 1
    assert events.count("session.start") == events.count("session.stop")
