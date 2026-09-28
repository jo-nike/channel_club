"""Small JSON state file that keeps admin settings and Live across restarts.

One document, {version, userChannelSelection, presenceVisible, liveChannelId,
liveSetBy}, written atomically (temp file in the same directory, fsync,
os.replace). Only the live channel's id is stored, never the Channel itself: it
carries a stream URL, so the id is re-resolved against the catalogue on start.

An empty settings.state_file disables it: nothing is read or written. A missing,
corrupt or other-version file falls back to defaults with one warning, and a
failed write logs a warning; neither ever stops the app.
"""

import asyncio
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from loguru import logger

from app.config import settings

# Module-level logger with service context
log = logger.bind(service="state_store")

STATE_VERSION = 1

DEFAULTS: dict[str, Any] = {
    "version": STATE_VERSION,
    "userChannelSelection": False,
    "presenceVisible": False,
    "liveChannelId": None,
    "liveSetBy": None,
}

# The last loaded or saved document; saves merge into it (reset with reset_state_store)
_document: dict[str, Any] = dict(DEFAULTS)
# Created on first save, so it binds to the running loop
_lock: asyncio.Lock | None = None


def _valid(document: Any) -> bool:
    return (
        isinstance(document, dict)
        and document.get("version") == STATE_VERSION
        and isinstance(document.get("userChannelSelection"), bool)
        and isinstance(document.get("presenceVisible"), bool)
        and isinstance(document.get("liveChannelId"), str | None)
        and isinstance(document.get("liveSetBy"), str | None)
    )


def load() -> dict[str, Any]:
    """Read the state file, falling back to defaults when it is unusable.

    Returns:
        A copy of the loaded document (defaults when disabled, missing or invalid).
    """
    global _document
    _document = dict(DEFAULTS)
    if not settings.state_file:
        return dict(_document)
    try:
        document = json.loads(Path(settings.state_file).read_text())
    except FileNotFoundError:
        log.warning("State file {} not found; starting from defaults", settings.state_file)
        return dict(_document)
    except (OSError, ValueError) as exc:
        log.warning(
            "State file {} unreadable ({}); starting from defaults", settings.state_file, exc
        )
        return dict(_document)
    if not _valid(document):
        log.warning(
            "State file {} invalid or another version; starting from defaults", settings.state_file
        )
        return dict(_document)
    _document = {key: document[key] for key in DEFAULTS}
    return dict(_document)


def current() -> dict[str, Any]:
    """A copy of the last loaded or saved document."""
    return dict(_document)


def _write(path: Path, document: dict[str, Any]) -> None:
    with tempfile.NamedTemporaryFile(
        "w", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
    ) as tmp:
        try:
            json.dump(document, tmp)
            tmp.flush()
            os.fsync(tmp.fileno())
        except BaseException:
            tmp.close()
            os.unlink(tmp.name)
            raise
    try:
        os.replace(tmp.name, path)
    except BaseException:
        os.unlink(tmp.name)
        raise


async def save(changes: dict[str, Any]) -> None:
    """Merge changes into the document and write it, if the store is enabled.

    Args:
        changes: The keys to update, e.g. {"presenceVisible": True}.
    """
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        _document.update(changes)
        if not settings.state_file:
            return
        try:
            await asyncio.to_thread(_write, Path(settings.state_file), dict(_document))
        except OSError as exc:
            log.warning("State file {} not saved: {}", settings.state_file, exc)


def reset_state_store() -> None:
    """Forget the document and lock (each test runs on a fresh loop)."""
    global _document, _lock
    _document = dict(DEFAULTS)
    _lock = None
