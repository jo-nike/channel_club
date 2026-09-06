"""Optional upload adapter. Destination and credentials are server-owned."""

import asyncio
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

from app.config import settings


async def upload_clip(source: Path, filename: str, content_type: str) -> dict[str, str]:
    if not settings.zipline_available:
        raise HTTPException(503, "Zipline uploads are disabled or not configured")
    try:
        async with (
            asyncio.timeout(120),
            httpx.AsyncClient(
                timeout=httpx.Timeout(120, connect=10),
                follow_redirects=False,
            ) as client,
        ):
            with source.open("rb") as file:
                response = await client.post(
                    settings.zipline_url.rstrip("/") + "/api/upload",
                    headers={"Authorization": settings.zipline_token},
                    files={"file": (filename, file, content_type)},
                )
        if response.status_code in (401, 403):
            raise HTTPException(502, "Zipline rejected the configured upload credentials")
        if response.status_code == 413:
            raise HTTPException(413, "Clip exceeds Zipline's upload size limit")
        if response.status_code == 429:
            raise HTTPException(429, "Zipline is busy; try again later")
        if not response.is_success:
            raise HTTPException(502, "Zipline rejected the upload; check its quota and file limits")
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
        return {"url": url, "name": name}
    except (httpx.TimeoutException, TimeoutError) as from_timeout:
        raise HTTPException(
            504, "Upload timed out. Check Zipline before retrying; the file may have arrived."
        ) from from_timeout
    except httpx.HTTPError as exc:
        raise HTTPException(
            502, "Could not confirm upload. Check Zipline before retrying."
        ) from exc
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(
            502, "Zipline returned an invalid response. Check Zipline before retrying."
        ) from exc
