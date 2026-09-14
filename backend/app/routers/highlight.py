"""Highlight capture API endpoints.

Provides endpoints for:
- Checking highlight feature status
- Saving highlights from active recordings
- Getting recording status for a channel
"""

import asyncio
import tempfile
from datetime import datetime
from pathlib import Path as FilePath
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.responses import FileResponse, Response
from loguru import logger
from pydantic import BaseModel

from app.config import settings
from app.models.auth import TokenPayload
from app.models.channel import ChannelId, validate_channel_id
from app.routers.auth_deps import get_current_user, get_current_user_or_token
from app.services.highlight import highlight_service
from app.services.media_export import encode_file, media_duration, owned_thread
from app.services.media_limits import export_budget
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


CaptureIdPath = Path(..., pattern=r"^[A-Za-z0-9_-]{16,64}$", description="Capture id")


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
    with source.open("wb") as output:
        async with asyncio.timeout(30):
            async for chunk in request.stream():
                size += len(chunk)
                if size > settings.media_export_max_bytes:
                    raise HTTPException(413, "Preview exceeds export size limit")
                await owned_thread(output.write, chunk)
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
    with (
        export_budget.slot(user.sub),
        tempfile.TemporaryDirectory(prefix="highlight-upload-") as directory,
    ):
        source = FilePath(directory) / f"clip.{format}"
        try:
            await ingest_preview(request, source)
            await media_duration(source)
            filename = f"highlight-{datetime.now().strftime('%Y-%m-%dT%H-%M-%S')}.{format}"
            return await upload_clip(source, filename, content_type)
        except TimeoutError:
            raise HTTPException(408, "Clip upload to the viewer timed out") from None
        except (OSError, ValueError):
            raise HTTPException(400, "Unable to read clip") from None


@router.get("/status/{channel_id}", response_model=HighlightStatusResponse)
async def get_highlight_status(
    channel_id: ChannelId = Path(..., description="Channel ID to check status for"),
    user: TokenPayload = Depends(get_current_user),
) -> HighlightStatusResponse:
    """Get highlight recording status for a channel.

    Returns whether recording is active and buffer fill level.
    Auto-starts recording for ErsatzTV channels if not already recording.
    """
    try:
        validate_channel_id(channel_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    log.debug("GET /highlight/status/{} request", channel_id)

    # Auto-start recording if enabled but not already recording
    status = highlight_service.get_status(channel_id)
    if status["enabled"] and not status["recording"]:
        started = await highlight_service.start_recording(channel_id, "", owner=user.sub)
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
    channel_id: ChannelId = Path(..., description="Channel ID to capture"),
    user: TokenPayload = Depends(get_current_user),
) -> CaptureResponse:
    """Snapshot the recent buffer server-side; the editor streams it by range."""
    if not settings.highlight_enabled:
        raise HTTPException(503, "Highlight feature is disabled")
    capture, error = await highlight_service.create_capture(channel_id, owner=user.sub)
    if error or capture is None:
        log.warning("Highlight capture failed for channel {}: {}", channel_id, error)
        raise HTTPException(400, error or "Failed to create highlight")
    return CaptureResponse(
        id=capture.id,
        duration=capture.duration,
        bytes=capture.size,
        expiresAt=capture.expires_at,
    )


@router.get("/capture/{capture_id}")
async def get_capture(
    capture_id: str = CaptureIdPath,
    download: bool = Query(False),
    user: TokenPayload = Depends(get_current_user_or_token),
) -> FileResponse:
    """Serve the owner's capture with range support so media elements can seek early."""
    capture = highlight_service.get_capture(capture_id, user.sub)
    if capture is None:
        raise HTTPException(404, "Capture not found")
    headers = {"Cache-Control": "private, no-store"}
    if download:
        timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
        filename = f"highlight-{capture.channel_id}-{timestamp}.mp4"
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return FileResponse(capture.path, media_type="video/mp4", headers=headers)


@router.delete("/capture/{capture_id}", status_code=204)
async def delete_capture(
    capture_id: str = CaptureIdPath,
    user: TokenPayload = Depends(get_current_user),
) -> Response:
    """Free the capture as soon as the editor closes; unknown ids are already gone."""
    await highlight_service.delete_capture(capture_id, user.sub)
    return Response(status_code=204)


@router.post("/export")
async def export_preview(
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
    source = highlight_service.get_capture(capture, user.sub)
    if source is None:
        raise HTTPException(404, "Capture not found")
    with (
        export_budget.slot(user.sub),
        tempfile.TemporaryDirectory(prefix="highlight-preview-") as directory,
    ):
        try:
            video = await encode_file(
                source.path, FilePath(directory) / f"export.{format}", format, start_time, end_time
            )
        except TimeoutError:
            raise HTTPException(408, "Clip conversion timed out") from None
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        except OSError:
            raise HTTPException(400, "Unable to convert capture") from None
    return Response(
        video,
        media_type=f"video/{format}",
        headers={
            "Content-Disposition": f'attachment; filename="highlight.{format}"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/{channel_id}")
async def save_highlight(
    channel_id: ChannelId = Path(..., description="Channel ID to save highlight for"),
    format: Literal["mp4", "webm"] = Query("mp4", description="Output format: mp4 or webm"),
    start_time: float | None = Query(
        None,
        ge=0,
        allow_inf_nan=False,
        description="Start time in seconds from beginning of buffer",
    ),
    end_time: float | None = Query(
        None, ge=0, allow_inf_nan=False, description="End time in seconds from beginning of buffer"
    ),
    user: TokenPayload = Depends(get_current_user),
) -> Response:
    """Save highlight for a channel.

    Returns the video file as a download with appropriate filename.
    Format can be mp4 (fast, universal) or webm (smaller, open format).
    Optionally trim the clip using start_time and end_time parameters.
    """
    log.info(
        "POST /highlight/{} (format={}, start={}, end={}) request from user {}",
        channel_id,
        format,
        start_time,
        end_time,
        user.sub,
    )

    if not settings.highlight_enabled:
        raise HTTPException(
            status_code=503,
            detail="Highlight feature is disabled",
        )

    # Validate trim parameters
    if start_time is not None and end_time is not None and start_time >= end_time:
        raise HTTPException(
            status_code=400,
            detail="start_time must be less than end_time",
        )

    video_bytes, error = await highlight_service.save_highlight(
        channel_id, format=format, start_time=start_time, end_time=end_time, owner=user.sub
    )

    if error:
        log.warning("Highlight save failed for channel {}: {}", channel_id, error)
        raise HTTPException(
            status_code=400,
            detail=error,
        )

    if not video_bytes:
        raise HTTPException(
            status_code=500,
            detail="Failed to create highlight",
        )

    # Generate filename with ISO timestamp
    timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    filename = f"highlight-{channel_id}-{timestamp}.{format}"

    # Set appropriate media type
    media_type = "video/webm" if format == "webm" else "video/mp4"

    log.info(
        "Returning {} highlight for channel {} ({:.1f} KB)",
        format.upper(),
        channel_id,
        len(video_bytes) / 1024,
    )

    return Response(
        content=video_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(video_bytes)),
        },
    )
