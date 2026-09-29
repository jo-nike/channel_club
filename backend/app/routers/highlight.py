"""Highlight capture API endpoints.

Provides endpoints for:
- Checking highlight feature status
- Saving highlights from active recordings
- Getting recording status for a channel
"""

import asyncio
import shutil
from collections.abc import Awaitable
from contextlib import suppress
from datetime import datetime
from pathlib import Path as FilePath
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.responses import FileResponse, Response
from loguru import logger
from pydantic import BaseModel
from starlette.background import BackgroundTask
from starlette.requests import ClientDisconnect

from app.config import settings
from app.models.auth import TokenPayload
from app.models.channel import ChannelId
from app.routers.auth_deps import get_current_user, get_current_user_or_token
from app.services.highlight import (
    CLIP_SAVE_ERROR,
    RECORDER_GONE_ERROR,
    Capture,
    highlight_service,
)
from app.services.media_export import (
    encode_file,
    media_duration,
    new_workspace,
    remove_workspace,
    workspace,
)
from app.services.media_limits import export_budget, upload_budget
from app.services.zipline import upload_clip

router = APIRouter(prefix="/api/highlight", tags=["highlight"])
log = logger.bind(router="highlight")


class HighlightStatusResponse(BaseModel):
    """Response for highlight feature status."""

    enabled: bool
    recording: bool
    ready: bool = False
    bufferSeconds: float = 0
    maxBufferSeconds: int = 60


class HighlightFeatureResponse(BaseModel):
    """Response for feature flag check."""

    enabled: bool
    ziplineEnabled: bool = False


class CaptureResponse(BaseModel):
    """A server-held snapshot the editor streams by URL and exports by id."""

    id: str
    duration: float
    bytes: int
    expiresAt: float
    # Server time of the request and when the capture's last frame was recorded (Unix seconds)
    pressedAt: float
    endsAt: float
    # A capability path for the editor's <video>: no session token in the URL
    previewUrl: str


class DownloadLinkResponse(BaseModel):
    """A single-use, short-lived download link that carries no session token."""

    url: str


# How often a running export checks whether the browser is still waiting for it
DISCONNECT_POLL_SECONDS = 0.5

# How long an upload may go without receiving a body chunk
UPLOAD_IDLE_SECONDS = 30

CaptureIdPath = Path(..., pattern=r"^[A-Za-z0-9_-]{16,64}$", description="Capture id")


def capture_file(capture: Capture, download: bool) -> FileResponse:
    headers = {"Cache-Control": "private, no-store"}
    if download:
        timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
        filename = f"highlight-{capture.channel_id}-{timestamp}.mp4"
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return FileResponse(capture.path, media_type="video/mp4", headers=headers)


@router.get("/feature", response_model=HighlightFeatureResponse)
async def get_feature_status(
    user: TokenPayload = Depends(get_current_user),
) -> HighlightFeatureResponse:
    """Check if highlight feature is enabled.

    This endpoint allows the frontend to conditionally show/hide
    the highlight button based on the server-side feature flag.
    """
    log.debug("GET /highlight/feature request")
    return HighlightFeatureResponse(
        enabled=settings.highlight_enabled, ziplineEnabled=settings.zipline_available
    )


async def ingest_preview(request: Request, source: FilePath) -> None:
    size = 0
    chunks = aiter(request.stream())
    with source.open("wb") as output:
        while True:
            # A slow uplink may take minutes for a long clip; only a stalled one times out.
            async with asyncio.timeout(UPLOAD_IDLE_SECONDS):
                chunk = await anext(chunks, None)
            if chunk is None:
                break
            size += len(chunk)
            if size > settings.media_export_max_bytes:
                raise HTTPException(413, "Preview exceeds export size limit")
            # A body chunk is a page-cache write of microseconds; no worker thread per chunk.
            output.write(chunk)
    if not size:
        raise HTTPException(400, "Preview is empty")


@router.post("/upload")
async def upload_highlight(
    request: Request,
    format: Literal["mp4", "webm"] = Query("mp4"),
    user: TokenPayload = Depends(get_current_user),
) -> dict[str, str]:
    """Upload already prepared media; disabled requests never ingest or contact Zipline."""
    if not settings.zipline_available:
        raise HTTPException(503, "Zipline uploads are disabled or not configured")
    content_type = f"video/{format}"
    if request.headers.get("content-type", "").split(";")[0] != content_type:
        raise HTTPException(415, f"Expected {content_type}")
    with upload_budget.slot(user.account_key):
        try:
            async with workspace("highlight-upload-") as directory:
                source = directory / f"clip.{format}"

                async def publish() -> dict[str, str]:
                    await media_duration(source)
                    filename = f"highlight-{datetime.now().strftime('%Y-%m-%dT%H-%M-%S')}.{format}"
                    return await upload_clip(source, filename, content_type)

                try:
                    # Reading the body notices a cancel itself (ClientDisconnect); polling for one
                    # meanwhile would take body chunks off the same receive channel.
                    await ingest_preview(request, source)
                    # A cancel during the Zipline POST stops it instead of publishing the clip.
                    return await unless_disconnected(request, publish())
                except ClientDisconnect:
                    log.info("Client left during a clip upload")
                    raise HTTPException(499, "Client closed the request") from None
                except TimeoutError:
                    raise HTTPException(408, "Clip upload to the viewer timed out") from None
                except (OSError, ValueError):
                    raise HTTPException(400, "Unable to read clip") from None
        except OSError as exc:
            # Only creating the workspace gets here; failures inside are "Unable to read clip".
            log.bind(event="highlight.capture_failed", errno=exc.errno).warning(
                "Clip upload workspace failed: {}", exc
            )
            raise HTTPException(400, CLIP_SAVE_ERROR) from None


@router.get("/status/{channel_id}", response_model=HighlightStatusResponse)
async def get_highlight_status(
    channel_id: Annotated[ChannelId, Path(description="Channel ID to check status for")],
    user: TokenPayload = Depends(get_current_user),
) -> HighlightStatusResponse:
    """Get highlight recording status for a channel.

    Returns whether recording is active and buffer fill level.
    Auto-starts recording for ErsatzTV channels if not already recording.
    """
    log.debug("GET /highlight/status/{} request", channel_id)

    # Auto-start recording if enabled but not already recording
    status = highlight_service.get_status(channel_id)
    if status["enabled"] and not status["recording"]:
        started = await highlight_service.start_recording(channel_id, "", owner=user.account_key)
        if started:
            status = highlight_service.get_status(channel_id)

    return HighlightStatusResponse(
        enabled=status["enabled"],
        recording=status["recording"],
        ready=status.get("ready", False),
        bufferSeconds=status.get("bufferSeconds", 0),
        maxBufferSeconds=status.get("maxBufferSeconds", settings.highlight_buffer_seconds),
    )


@router.post("/{channel_id}/capture", response_model=CaptureResponse)
async def create_capture(
    request: Request,
    channel_id: Annotated[ChannelId, Path(description="Channel ID to capture")],
    user: TokenPayload = Depends(get_current_user),
) -> CaptureResponse:
    """Snapshot the recent buffer server-side; the editor streams it by range."""
    if not settings.highlight_enabled:
        raise HTTPException(503, "Highlight feature is disabled")
    # Captures and slots belong to the account, so everyone signed in to one shared local
    # login (viewer) shares its captures, up to MAX_CAPTURES_PER_OWNER, and its slots.
    # A viewer who leaves while waiting for a slot gives up their place in the queue.
    capture, error = await unless_disconnected(
        request, highlight_service.create_capture(channel_id, owner=user.account_key)
    )
    if error or capture is None:
        log.warning("Highlight capture failed for channel {}: {}", channel_id, error)
        # A server-side stop raced the capture; the viewer did nothing wrong.
        raise HTTPException(
            409 if error == RECORDER_GONE_ERROR else 400, error or "Failed to create highlight"
        )
    preview_token = highlight_service.issue_preview_token(capture.id, user.account_key)
    if preview_token is None:
        raise HTTPException(404, "Capture not found")
    return CaptureResponse(
        id=capture.id,
        duration=capture.duration,
        bytes=capture.size,
        expiresAt=capture.expires_at,
        pressedAt=capture.pressed_at,
        endsAt=capture.ends_at,
        previewUrl=f"/api/highlight/preview/{preview_token}",
    )


@router.get("/capture/{capture_id}")
async def get_capture(
    capture_id: str = CaptureIdPath,
    download: bool = Query(False),
    user: TokenPayload = Depends(get_current_user_or_token),
) -> FileResponse:
    """Serve the owner's capture with range support so media elements can seek early."""
    capture = highlight_service.get_capture(capture_id, user.account_key)
    if capture is None:
        raise HTTPException(404, "Capture not found")
    return capture_file(capture, download)


@router.get("/preview/{token}")
async def preview_capture(
    token: str = Path(..., pattern=r"^[A-Za-z0-9_-]{16,64}$", description="Preview token"),
) -> FileResponse:
    """Serve a capture, with range support, to whoever holds its preview token."""
    capture = highlight_service.redeem_preview_token(token)
    if capture is None:
        raise HTTPException(404, "Capture not found")
    return capture_file(capture, download=False)


@router.post("/capture/{capture_id}/download-token", response_model=DownloadLinkResponse)
async def create_download_link(
    capture_id: str = CaptureIdPath,
    user: TokenPayload = Depends(get_current_user),
) -> DownloadLinkResponse:
    """Let the browser save the capture directly without putting the JWT in the URL."""
    token = highlight_service.issue_download_token(capture_id, user.account_key)
    if token is None:
        raise HTTPException(404, "Capture not found")
    return DownloadLinkResponse(url=f"/api/highlight/download/{token}")


@router.get("/download/{token}")
async def download_capture(
    request: Request,
    token: str = Path(..., pattern=r"^[A-Za-z0-9_-]{16,64}$", description="Download token"),
) -> FileResponse:
    """Serve a capture once to whoever holds its download token, as an attachment.

    Range requests may follow until the token expires, so an interrupted download resumes.
    """
    capture = highlight_service.redeem_download_token(
        token, range_request="range" in request.headers
    )
    if capture is None:
        raise HTTPException(404, "Download link expired or already used")
    return capture_file(capture, download=True)


@router.delete("/capture/{capture_id}", status_code=204)
async def delete_capture(
    capture_id: str = CaptureIdPath,
    user: TokenPayload = Depends(get_current_user),
) -> Response:
    """Free the capture as soon as the editor closes; unknown ids are already gone."""
    await highlight_service.delete_capture(capture_id, user.account_key)
    return Response(status_code=204)


async def unless_disconnected[T](request: Request, work: Awaitable[T]) -> T:
    """Starlette keeps running a handler after the client leaves; stop the work when it does.

    Cancelling an encode kills its FFmpeg process, so the caller's export slot is freed
    as soon as the browser cancels instead of when the encode finishes.
    """
    task = asyncio.ensure_future(work)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=DISCONNECT_POLL_SECONDS)
            if done:
                return task.result()
            if await request.is_disconnected():
                log.info("Client left during a clip export; stopping the encode")
                raise HTTPException(499, "Client closed the request")
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


@router.post("/export")
async def export_preview(
    request: Request,
    capture: str = Query(..., pattern=r"^[A-Za-z0-9_-]{16,64}$"),
    format: Literal["mp4", "webm"] = Query("mp4"),
    start_time: float | None = Query(None, ge=0, allow_inf_nan=False),
    end_time: float | None = Query(None, ge=0, allow_inf_nan=False),
    user: TokenPayload = Depends(get_current_user),
) -> Response:
    """Transform the exact snapshot the user previewed, without recapturing live TV."""
    if not settings.highlight_enabled:
        raise HTTPException(503, "Highlight feature is disabled")
    if start_time is not None and end_time is not None and start_time >= end_time:
        raise HTTPException(400, "start_time must be less than end_time")
    source = highlight_service.get_capture(capture, user.account_key)
    if source is None:
        raise HTTPException(404, "Capture not found")

    async def encode(directory: FilePath) -> FilePath:
        # Waits for a slot inside the disconnect watch, so a viewer who left never takes one.
        # The slot is released when the encode finishes, before the response is sent.
        async with export_budget.waiting_slot(user.account_key):
            return await encode_file(
                source.path,
                directory / f"export.{format}",
                format,
                start_time,
                end_time,
            )

    kept = False
    directory: FilePath | None = None
    try:
        # The file outlives the handler: it is streamed from disk, then its workspace removed.
        directory = new_workspace("highlight-preview-")
        video = await unless_disconnected(request, encode(directory))
        kept = True
    except TimeoutError:
        raise HTTPException(408, "Clip conversion timed out") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except OSError as exc:
        log.bind(
            event="highlight.capture_failed", channel_id=source.channel_id, errno=exc.errno
        ).warning("Clip export failed: {}", exc)
        raise HTTPException(400, CLIP_SAVE_ERROR) from None
    finally:
        if not kept and directory is not None:
            await remove_workspace(directory)
    return FileResponse(
        video,
        media_type=f"video/{format}",
        headers={
            "Content-Disposition": f'attachment; filename="highlight.{format}"',
            "Cache-Control": "no-store",
        },
        # pyright matches rmtree's first overload (the deprecated onerror one) to the ParamSpec
        background=BackgroundTask(shutil.rmtree, directory, True),  # pyright: ignore[reportCallIssue]
    )
