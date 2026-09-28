"""R-01: POST /api/csp-report logs sampled csp.violation events and always answers 204."""

import json
from collections.abc import Iterator
from io import StringIO
from typing import Any

import pytest
from fastapi.testclient import TestClient
from loguru import logger

from app.main import app
from app.routers import csp_report


class Clock:
    now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch) -> Clock:
    fake = Clock()
    monkeypatch.setattr(csp_report, "monotonic", fake)
    return fake


@pytest.fixture
def violations() -> list[dict[str, Any]]:
    """The bound fields of every csp.violation line logged so far (filled by post)."""
    return []


@pytest.fixture
def post(violations) -> Iterator[Any]:
    output = StringIO()
    handler_id = logger.add(output, format="{message}", serialize=True, level="DEBUG")
    client = TestClient(app)

    def send(body: bytes | str, content_type: str = "application/csp-report") -> int:
        response = client.post(
            "/api/csp-report", content=body, headers={"Content-Type": content_type}
        )
        violations[:] = [
            record["record"]["extra"]
            for record in map(json.loads, output.getvalue().splitlines())
            if record["record"]["extra"].get("event") == "csp.violation"
        ]
        return response.status_code

    yield send
    logger.remove(handler_id)


def legacy(directive: str, blocked: str, document: str = "https://tv.example.com/") -> str:
    return json.dumps(
        {
            "csp-report": {
                "document-uri": document,
                "violated-directive": directive + " 'self'",
                "effective-directive": directive,
                "blocked-uri": blocked,
                "source-file": "https://tv.example.com/assets/index.js?v=1",
            }
        }
    )


def test_legacy_report_is_logged_with_query_and_fragment_stripped(post, violations, clock):
    status = post(
        legacy(
            "connect-src",
            "wss://tv.example.com/api/ws?token=secret-jwt",
            "https://tv.example.com/watch?x=1#frag",
        )
    )
    assert status == 204
    assert len(violations) == 1
    line = violations[0]
    assert line["directive"] == "connect-src"
    assert line["blocked"] == "wss://tv.example.com/api/ws"
    assert line["document"] == "https://tv.example.com/watch"
    assert line["source"] == "https://tv.example.com/assets/index.js"
    assert line["dropped"] == 0
    assert "secret-jwt" not in json.dumps(line)


def test_reporting_api_list_is_logged_per_violation(post, violations, clock):
    body = json.dumps(
        [
            {
                "type": "csp-violation",
                "body": {
                    "documentURL": "https://tv.example.com/",
                    "effectiveDirective": "img-src",
                    "blockedURL": "https://i.imgur.com/cat.gif?t=1",
                    "sourceFile": "https://tv.example.com/assets/index.js",
                },
            },
            {"type": "deprecation", "body": {"id": "x"}},
            {
                "type": "csp-violation",
                "body": {"effectiveDirective": "script-src-elem", "blockedURL": "inline"},
            },
        ]
    )
    assert post(body, "application/reports+json") == 204
    assert [(v["directive"], v["blocked"]) for v in violations] == [
        ("img-src", "https://i.imgur.com/cat.gif"),
        ("script-src-elem", "inline"),
    ]


def test_duplicate_within_the_window_is_dropped_and_counted(post, violations, clock):
    post(legacy("img-src", "https://i.imgur.com/a.gif"))
    clock.now += 60
    post(legacy("img-src", "https://i.imgur.com/b.gif"))  # same directive and origin
    assert len(violations) == 1
    clock.now += 60
    post(legacy("img-src", "https://media.tenor.com/c.gif"))
    assert [(v["blocked"], v["dropped"]) for v in violations] == [
        ("https://i.imgur.com/a.gif", 0),
        ("https://media.tenor.com/c.gif", 1),
    ]
    clock.now += csp_report.KEY_WINDOW_SECONDS
    post(legacy("img-src", "https://i.imgur.com/d.gif"))
    assert violations[-1]["blocked"] == "https://i.imgur.com/d.gif"


def test_at_most_sixty_lines_a_minute(post, violations, clock):
    for index in range(csp_report.LINES_PER_MINUTE + 5):
        post(legacy("img-src", f"https://host{index}.example.com/x.png"))
    assert len(violations) == csp_report.LINES_PER_MINUTE
    clock.now += 60
    post(legacy("img-src", "https://late.example.com/x.png"))
    assert violations[-1]["blocked"] == "https://late.example.com/x.png"
    assert violations[-1]["dropped"] == 5


@pytest.mark.parametrize(
    ("body", "content_type"),
    [
        (b"not json", "application/csp-report"),
        (b"\xff\xfe", "application/csp-report"),
        (b"[" * 20000, "application/reports+json"),
        (b'{"csp-report": "x"}', "application/csp-report"),
        (b'[{"type": "csp-violation", "body": 3}, 7]', "application/reports+json"),
        (b"", "text/plain"),
    ],
)
def test_garbage_is_204_and_not_logged(post, violations, clock, body, content_type):
    assert post(body, content_type) == 204
    assert violations == []


def test_leaves_sampling_state_behind(post, clock):
    post(legacy("img-src", "https://i.imgur.com/a.gif"))
    assert csp_report._last_logged


def test_next_test_starts_with_clean_sampling_state():
    assert csp_report._last_logged == {}
    assert csp_report._dropped == 0
    assert csp_report._minute_lines == 0
