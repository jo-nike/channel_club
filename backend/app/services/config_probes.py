"""Connection tests: can this server reach a source or service with these settings?

Each test is bounded: no redirects are followed, bodies are read up to a
limit, and the whole test gives up after PROBE_TIMEOUT_SECONDS. The outcome is
structured (ok, a reason, counts) and the app words it; an upstream's own text
is never passed on, so a test can't be used to read other servers' pages.
"""

import asyncio
import json
import re
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any

import httpx
from loguru import logger

from app.metadata import APP_NAME
from app.models.admin_config import ProbeCounts, ProbeKind, ProbeReason, ProbeResult
from app.services.bounded_http import read_bounded
from app.services.tls import SSL_CONTEXT
from app.services.xmltv_cache import parse_xmltv_datetime

log = logger.bind(service="config_probes")

PROBE_TIMEOUT_SECONDS = 5
# The guide is only counted in days, so it gets a little less time than the test
GUIDE_TIMEOUT_SECONDS = 4
PROBE_BODY_BYTES = 8 * 1024 * 1024
GUIDE_BODY_BYTES = 16 * 1024 * 1024
# Programme end times, read without parsing the whole guide
_PROGRAMME_STOP = re.compile(rb"<programme\b[^>]*?\sstop=[\"']([^\"']+)[\"']")
NTFY_TEST_MESSAGE = "Feedback from Channel Club will arrive here."


class ProbeFailedError(Exception):
    """A test that reached a verdict other than ok."""

    def __init__(self, reason: ProbeReason) -> None:
        super().__init__(reason)
        self.reason: ProbeReason = reason


def _check_status(status: int) -> None:
    if status in (401, 403):
        raise ProbeFailedError("auth")
    if status == 404:
        raise ProbeFailedError("not_found")
    # A redirect counts as a wrong address: it is never followed
    if not 200 <= status < 300:
        raise ProbeFailedError("http")


async def _read(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    limit: int = PROBE_BODY_BYTES,
    **kwargs: Any,
) -> bytes:
    async with client.stream(method, url, **kwargs) as response:
        _check_status(response.status_code)
        return await read_bounded(response, limit)


def _json(body: bytes) -> Any:
    try:
        return json.loads(body)
    except ValueError:
        raise ProbeFailedError("invalid") from None


async def _dispatcharr(client: httpx.AsyncClient, values: Mapping[str, str]) -> ProbeCounts:
    url = values.get("dispatcharr_url", "")
    key = values.get("dispatcharr_api_key", "")
    if not url:
        raise ProbeFailedError("invalid")
    headers = {"Authorization": f"ApiKey {key}"} if key else {}
    groups, channels = await asyncio.gather(
        _read(client, "GET", f"{url}/api/channels/groups/", headers=headers),
        _read(client, "GET", f"{url}/api/channels/channels/", headers=headers),
    )
    groups, channels = _json(groups), _json(channels)
    if not isinstance(groups, list) or not isinstance(channels, list):
        raise ProbeFailedError("invalid")
    group_ids = {group.get("id") for group in groups if isinstance(group, dict)}
    used = {
        channel.get("channel_group_id") for channel in channels if isinstance(channel, dict)
    } & group_ids
    return ProbeCounts(channels=len(channels), groups=len(used))


async def _guide_days(client: httpx.AsyncClient, base: str) -> int | None:
    """Whole days of guide ahead of now, or None when the guide can't be read in time."""
    try:
        async with asyncio.timeout(GUIDE_TIMEOUT_SECONDS):
            body = await _read(client, "GET", f"{base}/iptv/xmltv.xml", GUIDE_BODY_BYTES)
        ends = []
        for match in _PROGRAMME_STOP.finditer(body):
            try:
                ends.append(parse_xmltv_datetime(match.group(1).decode("ascii")))
            except (ValueError, IndexError, UnicodeDecodeError):
                continue
    except Exception:
        return None
    if not ends:
        return 0
    return max(0, int((max(ends) - datetime.now(UTC)).total_seconds() // 86400))


async def _ersatztv(client: httpx.AsyncClient, values: Mapping[str, str]) -> ProbeCounts:
    base = values.get("ersatztv_base_url", "")
    key = values.get("ersatztv_api_key", "")
    if not base:
        raise ProbeFailedError("invalid")
    playlist, days = await asyncio.gather(
        _read(client, "GET", f"{base}/iptv/channels.m3u"), _guide_days(client, base)
    )
    if key:
        # Only the session stats need the key, so it is checked only when given
        await _read(client, "GET", f"{base}/api/version", headers={"X-Etv-Api-Key": key})
    text = playlist.decode("utf-8", "replace")
    if not text.lstrip().startswith("#EXTM3U"):
        raise ProbeFailedError("invalid")
    channels = sum(1 for line in text.splitlines() if line.startswith("#EXTINF"))
    return ProbeCounts(channels=channels, guide_days=days)


async def _giphy(client: httpx.AsyncClient, values: Mapping[str, str]) -> ProbeCounts:
    key = values.get("giphy_api_key", "")
    if not key:
        raise ProbeFailedError("invalid")
    body = await _read(
        client,
        "GET",
        "https://api.giphy.com/v1/gifs/trending",
        params={"api_key": key, "limit": 1, "rating": "pg"},
    )
    data = _json(body)
    if not isinstance(data, dict) or not isinstance(data.get("data"), list):
        raise ProbeFailedError("invalid")
    return ProbeCounts()


async def _zipline(client: httpx.AsyncClient, values: Mapping[str, str]) -> ProbeCounts:
    url = values.get("zipline_url", "")
    token = values.get("zipline_token", "")
    if not url or not token:
        raise ProbeFailedError("invalid")
    data = _json(await _read(client, "GET", f"{url}/api/user", headers={"Authorization": token}))
    # Zipline 4 answers {"user": {...}}, which is the API the uploads use
    user = data.get("user") if isinstance(data, dict) else None
    username = user.get("username") if isinstance(user, dict) else None
    if not isinstance(username, str) or not username:
        raise ProbeFailedError("invalid")
    return ProbeCounts(username=username[:64])


async def _ntfy(client: httpx.AsyncClient, values: Mapping[str, str]) -> ProbeCounts:
    url = values.get("ntfy_url", "")
    topic = values.get("ntfy_topic", "")
    token = values.get("ntfy_token", "")
    if not url or not topic:
        raise ProbeFailedError("invalid")
    headers = {
        "Title": f"{APP_NAME} test",
        "Tags": "white_check_mark",
        "Content-Type": "text/plain; charset=utf-8",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    await _read(
        client,
        "POST",
        f"{url}/{topic}",
        64 * 1024,
        content=NTFY_TEST_MESSAGE.encode(),
        headers=headers,
    )
    return ProbeCounts()


PROBES: dict[
    ProbeKind, Callable[[httpx.AsyncClient, Mapping[str, str]], Awaitable[ProbeCounts]]
] = {
    "dispatcharr": _dispatcharr,
    "ersatztv": _ersatztv,
    "giphy": _giphy,
    "zipline": _zipline,
    "ntfy": _ntfy,
}


async def probe(kind: ProbeKind, values: Mapping[str, str]) -> ProbeResult:
    """Run one connection test with these values (secrets unwrapped)."""
    try:
        async with (
            asyncio.timeout(PROBE_TIMEOUT_SECONDS),
            httpx.AsyncClient(
                timeout=PROBE_TIMEOUT_SECONDS, follow_redirects=False, verify=SSL_CONTEXT
            ) as client,
        ):
            counts = await PROBES[kind](client, values)
    except ProbeFailedError as failed:
        result = ProbeResult(ok=False, reason=failed.reason)
    except (TimeoutError, httpx.TimeoutException):
        result = ProbeResult(ok=False, reason="timeout")
    except httpx.HTTPError:
        result = ProbeResult(ok=False, reason="unreachable")
    except ValueError:
        # read_bounded: the body was over its limit
        result = ProbeResult(ok=False, reason="invalid")
    else:
        result = ProbeResult(ok=True, counts=counts)
    log.info("Connection test for {}: {}", kind, "ok" if result.ok else result.reason)
    return result
