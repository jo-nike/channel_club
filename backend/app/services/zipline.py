"""Optional upload adapter. Destination and credentials are server-owned."""

import asyncio
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException
from loguru import logger

from app.config import settings
from app.services.tls import SSL_CONTEXT

log = logger.bind(service="zipline")


def failed(
    status_code: int, detail: str, category: str, upstream: int | None = None
) -> HTTPException:
    """Log the upload's failure once: status and category only, never the body or token."""
    log.bind(event="zipline.upload_failed", category=category, upstream_status=upstream).warning(
        "Zipline upload failed: {} (upstream status {})", category, upstream
    )
    return HTTPException(status_code, detail)


async def upload_clip(source: Path, filename: str, content_type: str) -> dict[str, str]:
    if not settings.zipline_available:
        raise HTTPException(503, "Zipline uploads are disabled or not configured")
    size = source.stat().st_size
    started = time.monotonic()
    status: int | None = None
    try:
        async with (
            asyncio.timeout(120),
            httpx.AsyncClient(
                timeout=httpx.Timeout(120, connect=10),
                follow_redirects=False,
                verify=SSL_CONTEXT,
            ) as client,
        ):
            with source.open("rb") as file:
                response = await client.post(
                    settings.zipline_url.rstrip("/") + "/api/upload",
                    headers={"Authorization": settings.zipline_token},
                    files={"file": (filename, file, content_type)},
                )
        status = response.status_code
        if status in (401, 403):
            raise failed(
                502, "Zipline rejected the configured upload credentials", "credentials", status
            )
        if status == 413:
            raise failed(413, "Clip exceeds Zipline's upload size limit", "too_large", status)
        if status == 429:
            raise failed(429, "Zipline is busy; try again later", "busy", status)
        if not response.is_success:
            raise failed(
                502,
                "Zipline rejected the upload; check its quota and file limits",
                "rejected",
                status,
            )
        data = response.json()["files"][0]
        url, name = data["url"], data["name"]
        if not isinstance(url, str):
            raise ValueError("Invalid upload URL")
        parsed = urlsplit(url)
        if (
            not isinstance(name, str)
            or not name
            or parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Invalid upload response")
        elapsed = time.monotonic() - started
        log.bind(event="zipline.upload", size=size, duration_seconds=round(elapsed, 2)).info(
            "Uploaded {:.1f} KB to Zipline in {:.1f}s", size / 1024, elapsed
        )
        return {"url": url, "name": name}
    except (httpx.TimeoutException, TimeoutError) as from_timeout:
        raise failed(
            504,
            "Upload timed out. Check Zipline before retrying; the file may have arrived.",
            "timeout",
        ) from from_timeout
    except httpx.HTTPError as exc:
        raise failed(
            502, "Could not confirm upload. Check Zipline before retrying.", "network"
        ) from exc
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise failed(
            502,
            "Zipline returned an invalid response. Check Zipline before retrying.",
            "invalid_response",
            status,
        ) from exc
