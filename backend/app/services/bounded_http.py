"""Bound decoded upstream bodies before parsing or serving them."""

import asyncio
from time import monotonic
from xml.etree.ElementTree import ParseError

import httpx
from defusedxml import DefusedXmlException

from app.services.tls import SSL_CONTEXT

MANIFEST_BYTES = 2 * 1024 * 1024
LOGO_BYTES = 4 * 1024 * 1024
FEED_BYTES = 32 * 1024 * 1024
BODY_SECONDS = 15


def failure_reason(exc: BaseException) -> str:
    """A short reason for health reports; never the upstream URL.

    A parse error wrapped in a source's own exception is still 'invalid XMLTV'.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    if isinstance(exc, httpx.ConnectError):
        return "connection failed"
    if isinstance(exc, httpx.TimeoutException | TimeoutError):
        return "timeout"
    if isinstance(exc, httpx.HTTPError):
        return "request failed"
    # DefusedXmlException is a ValueError, so it is checked before the byte budget's
    if isinstance(exc, ParseError | DefusedXmlException) or isinstance(
        exc.__cause__, ParseError | DefusedXmlException
    ):
        return "invalid XMLTV"
    if isinstance(exc, ValueError):
        return "feed too large"
    return "refresh failed"


def decoded_response(response: httpx.Response, body: bytes) -> httpx.Response:
    """Wrap decoded bytes without applying the upstream's wire encoding again."""
    headers = response.headers.copy()
    for name in ("content-encoding", "content-length", "transfer-encoding"):
        headers.pop(name, None)
    return httpx.Response(
        response.status_code, headers=headers, content=body, request=response.request
    )


def check_length(response: httpx.Response, limit: int) -> None:
    try:
        size = int(response.headers.get("content-length", "0"))
    except ValueError:
        size = 0
    if size > limit:
        raise ValueError("Upstream body exceeds byte budget")


async def read_bounded(response: httpx.Response, limit: int) -> bytes:
    """Always close, including oversized, slow, malformed and cancelled bodies."""
    try:
        check_length(response, limit)
        data = bytearray()
        async with asyncio.timeout(BODY_SECONDS):
            async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                if len(data) + len(chunk) > limit:
                    raise ValueError("Upstream body exceeds byte budget")
                data.extend(chunk)
        return bytes(data)
    finally:
        await response.aclose()


def fetch_feed(url: str, timeout: float = BODY_SECONDS) -> httpx.Response:
    """Synchronous off-loop feed fetch, with decoded bytes and wall-time limits."""
    deadline = monotonic() + timeout
    with httpx.stream(
        "GET", url, timeout=min(timeout, 2), follow_redirects=False, verify=SSL_CONTEXT
    ) as response:
        response.raise_for_status()
        check_length(response, FEED_BYTES)
        data = bytearray()
        for chunk in response.iter_bytes():
            if monotonic() > deadline or len(data) + len(chunk) > FEED_BYTES:
                raise ValueError("Feed exceeds byte/time budget")
            data.extend(chunk)
        return decoded_response(response, bytes(data))
