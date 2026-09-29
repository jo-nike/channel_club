"""Optional feedback push to an ntfy topic. Destination and token are server-owned."""

import asyncio
import math
import re
import time
import unicodedata
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
from fastapi import HTTPException
from loguru import logger

from app.config import settings
from app.metadata import APP_NAME, APP_VERSION
from app.models.feedback import FeedbackContext, FeedbackKind
from app.services.tls import SSL_CONTEXT

log = logger.bind(service="feedback")

# ntfy's default message-size-limit is 4096 bytes; stay clearly under it.
MAX_BODY_BYTES = 4000
MAX_TITLE_LENGTH = 100
WINDOW_SECONDS = 3600.0

# C0/C1 control characters except tab and newline.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")
_NON_PRINTABLE_ASCII = re.compile(r"[^\x20-\x7e]")

_TITLES: dict[FeedbackKind, str] = {
    "bug": "Bug report",
    "suggestion": "Suggestion",
    "other": "Feedback",
}
_TAGS: dict[FeedbackKind, str] = {
    "bug": "bug,channel-club",
    "suggestion": "bulb,channel-club",
    "other": "speech_balloon,channel-club",
}
_PRIORITIES: dict[FeedbackKind, str] = {"bug": "4", "suggestion": "3", "other": "3"}


@dataclass(frozen=True)
class NtfyMessage:
    """A message ready to publish. Header values are printable ASCII."""

    title: str
    body: str
    tags: str
    priority: str


def sanitize_text(value: str, max_length: int, *, multiline: bool = True) -> str:
    """Normalize user text: NFC, LF newlines, no control characters, bounded length.

    Returns an empty string when nothing printable remains. Truncation appends an
    ellipsis so the reader knows the text was cut.
    """
    text = unicodedata.normalize("NFC", value or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_CHARS.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text) if multiline else re.sub(r"[\n\t]+", " ", text)
    text = text.strip()
    if len(text) > max_length:
        text = text[: max_length - 1].rstrip() + "…"
    return text


def _ascii_only(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", _NON_PRINTABLE_ASCII.sub("", folded)).strip()


# --- Rate limiting -----------------------------------------------------------
#
# Per-process, in-memory, like chat history and the media budgets. Keyed by
# username with monotonic timestamps of accepted submissions.

_hits: dict[str, deque[float]] = {}


def reset() -> None:
    """Forget every recorded submission (tests)."""
    _hits.clear()


def _prune(username: str, now: float) -> deque[float] | None:
    hits = _hits.get(username)
    if hits is None:
        return None
    while hits and now - hits[0] > WINDOW_SECONDS:
        hits.popleft()
    if not hits:
        del _hits[username]
        return None
    return hits


def _too_many(wait: float) -> HTTPException:
    seconds = max(1, math.ceil(wait))
    return HTTPException(
        429,
        f"Please wait {seconds}s before sending more feedback",
        headers={"Retry-After": str(seconds)},
    )


def reserve(username: str, now: float | None = None) -> None:
    """Record a submission, or raise 429 when the user is over the cooldown or cap.

    Call before publishing so a burst of clicks cannot fan out; call release()
    if delivery then fails so an outage never spends the user's allowance.
    """
    now = time.monotonic() if now is None else now
    hits = _prune(username, now)
    if hits:
        cooldown = settings.feedback_cooldown_seconds - (now - hits[-1])
        if cooldown > 0:
            raise _too_many(cooldown)
        if len(hits) >= settings.feedback_hourly_limit:
            raise _too_many(WINDOW_SECONDS - (now - hits[0]))
    _hits.setdefault(username, deque()).append(now)


def release(username: str) -> None:
    """Drop the most recent reservation for a user after a failed delivery."""
    hits = _hits.get(username)
    if not hits:
        return
    hits.pop()
    if not hits:
        del _hits[username]


# --- Message composition ---------------------------------------------------


def build_message(
    *,
    kind: FeedbackKind,
    message: str,
    contact: str,
    username: str,
    role: str,
    context: FeedbackContext,
    sent_at: datetime | None = None,
) -> NtfyMessage:
    """Compose the ntfy title and body.

    Only server-controlled strings and an ASCII-folded username go in headers;
    everything the user wrote goes in the body, which is bounded in UTF-8 bytes.
    """
    sent_at = sent_at or datetime.now(UTC)
    who = _ascii_only(username) or "a viewer"
    title = f"[{APP_NAME}] {_TITLES[kind]} from {who}"[:MAX_TITLE_LENGTH]

    def field(value: str, fallback: str) -> str:
        return sanitize_text(value, 300, multiline=False) or fallback

    footer = "\n".join(
        [
            "",
            f"From: {field(username, 'unknown')} ({field(role, 'unknown')})",
            f"Contact: {field(contact, 'not provided')}",
            f"Version: {APP_VERSION} build {settings.app_build_id} ({settings.app_revision});"
            f" web {field(context.app_version, 'unknown')}",
            f"View: {field(context.path, '/')}  Session: {field(context.session_id, 'unknown')}",
            f"Client: {field(context.user_agent, 'unknown')}"
            f"  Viewport: {field(context.viewport, 'unknown')}",
            f"Sent: {sent_at.astimezone(UTC).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        ]
    )
    allowance = MAX_BODY_BYTES - len(footer.encode("utf-8")) - 1
    encoded = message.encode("utf-8")
    if len(encoded) > allowance:
        ellipsis = "…".encode()
        cut = encoded[: allowance - len(ellipsis)].decode("utf-8", "ignore").rstrip()
        message = cut + "…"
    return NtfyMessage(
        title=title,
        body=f"{message}\n{footer}",
        tags=_TAGS[kind],
        priority=_PRIORITIES[kind],
    )


# --- Delivery ------------------------------------------------------------------


async def publish(message: NtfyMessage, transport: httpx.AsyncBaseTransport | None = None) -> None:
    """POST the message to the configured topic. Upstream errors become 502/504."""
    if not settings.ntfy_available:
        raise HTTPException(503, "Feedback is disabled or not configured")
    headers = {
        "Title": message.title,
        "Tags": message.tags,
        "Priority": message.priority,
        "Content-Type": "text/plain; charset=utf-8",
    }
    token = settings.ntfy_token.get_secret_value().strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = settings.ntfy_url.rstrip("/") + "/" + settings.ntfy_topic
    try:
        async with (
            asyncio.timeout(20),
            httpx.AsyncClient(
                timeout=httpx.Timeout(15, connect=5),
                follow_redirects=False,
                transport=transport,
                verify=SSL_CONTEXT,
            ) as client,
        ):
            response = await client.post(url, content=message.body.encode("utf-8"), headers=headers)
    except (httpx.TimeoutException, TimeoutError) as exc:
        log.warning("Feedback delivery timed out")
        raise HTTPException(504, "Feedback service timed out; try again later") from exc
    except httpx.HTTPError as exc:
        log.warning("Feedback delivery failed: {}", type(exc).__name__)
        raise HTTPException(502, "Could not reach the feedback service") from exc

    if response.is_success:
        return
    log.warning("Feedback service returned {}", response.status_code)
    if response.status_code in (401, 403):
        raise HTTPException(502, "Feedback service rejected the configured credentials")
    if response.status_code == 429:
        raise HTTPException(429, "Feedback service is busy; try again later")
    if response.status_code in (400, 413):
        raise HTTPException(502, "Feedback service rejected the message")
    raise HTTPException(502, "Feedback service failed; try again later")
