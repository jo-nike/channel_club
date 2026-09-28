"""CSP violation reports from the SPA's Report-Only policy, logged for Loki."""

import json
from time import monotonic
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Request, Response
from loguru import logger

router = APIRouter(prefix="/api", tags=["csp"])
log = logger.bind(router="csp_report")

# One line per (directive, blocked origin) per window, and a global cap per
# minute, so one noisy page or a scripted flood cannot fill the log store.
KEY_WINDOW_SECONDS = 600
LINES_PER_MINUTE = 60

_last_logged: dict[tuple[str, str], float] = {}
_minute_started: float | None = None
_minute_lines = 0
_dropped = 0


def clear_csp_report_state() -> None:
    """Forget the sampling windows and the dropped count."""
    global _minute_started, _minute_lines, _dropped
    _last_logged.clear()
    _minute_started = None
    _minute_lines = 0
    _dropped = 0


def _strip(value: object) -> str:
    # The WebSocket URL still carries ?token=, so no query or fragment is logged
    if not isinstance(value, str):
        return ""
    return value.split("#", 1)[0].split("?", 1)[0]


def _origin(blocked: str) -> str:
    parts = urlsplit(blocked)
    if parts.netloc:
        return f"{parts.scheme}://{parts.netloc}"
    # A keyword such as inline or eval, or a scheme such as data
    return parts.scheme or blocked


def _reports(payload: Any) -> list[dict[str, str]]:
    """Normalise application/csp-report and application/reports+json bodies."""
    if isinstance(payload, dict) and isinstance(payload.get("csp-report"), dict):
        report = payload["csp-report"]
        return [
            {
                "directive": _strip(
                    report.get("effective-directive") or report.get("violated-directive")
                ),
                "blocked": _strip(report.get("blocked-uri")),
                "document": _strip(report.get("document-uri")),
                "source": _strip(report.get("source-file")),
            }
        ]
    if isinstance(payload, list):
        return [
            {
                "directive": _strip(item["body"].get("effectiveDirective")),
                "blocked": _strip(item["body"].get("blockedURL")),
                "document": _strip(item["body"].get("documentURL")),
                "source": _strip(item["body"].get("sourceFile")),
            }
            for item in payload
            if isinstance(item, dict)
            and item.get("type") == "csp-violation"
            and isinstance(item.get("body"), dict)
        ]
    return []


def _admit(directive: str, blocked: str, now: float) -> bool:
    global _minute_started, _minute_lines, _dropped
    if _minute_started is None or now - _minute_started >= 60:
        _minute_started = now
        _minute_lines = 0
        # Keep the key map bounded: forget windows that have already closed
        for key, logged_at in list(_last_logged.items()):
            if now - logged_at >= KEY_WINDOW_SECONDS:
                del _last_logged[key]
    key = (directive, _origin(blocked))
    logged_at = _last_logged.get(key)
    if (logged_at is not None and now - logged_at < KEY_WINDOW_SECONDS) or (
        _minute_lines >= LINES_PER_MINUTE
    ):
        _dropped += 1
        return False
    _last_logged[key] = now
    _minute_lines += 1
    return True


@router.post("/csp-report", status_code=204)
async def csp_report(request: Request) -> Response:
    """Log sampled violations. Always 204, so a browser never retries."""
    global _dropped
    try:
        payload = json.loads(await request.body())
    except (ValueError, RecursionError):
        log.debug("Unparseable CSP report ignored")
        return Response(status_code=204)
    reports = _reports(payload)
    if not reports:
        log.debug("CSP report with no violations ignored")
    for report in reports:
        if not _admit(report["directive"], report["blocked"], monotonic()):
            continue
        dropped, _dropped = _dropped, 0
        log.bind(event="csp.violation", dropped=dropped, **report).info(
            "CSP {} violation: {} on {}", report["directive"], report["blocked"], report["document"]
        )
    return Response(status_code=204)
