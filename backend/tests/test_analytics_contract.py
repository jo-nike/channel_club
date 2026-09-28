"""The analytics events and the Grafana dashboard that reads them agree.

Events are loguru records with an "event" extra, written as JSON lines by the
production sink. Loki's `| json` flattens them to record_extra_<field>, which is
what every dashboard query filters and aggregates on.
"""

import importlib.util
import json
import logging
import sys
from collections.abc import Callable, Iterator
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import pytest
from loguru import logger

from app.config import Settings
from app.logging_config import configure_logging

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
