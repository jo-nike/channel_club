"""Highlight capture API endpoints.

Provides endpoints for:
- Checking highlight feature status
- Saving highlights from active recordings
- Getting recording status for a channel
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import Response
from loguru import logger
from pydantic import BaseModel

from app.config import settings
from app.models.auth import TokenPayload
from app.models.channel import ChannelId, validate_channel_id
from app.routers.auth_deps import get_current_user
from app.services.highlight import highlight_service

router = APIRouter(prefix="/api/highlight", tags=["highlight"])
log = logger.bind(router="highlight")


class HighlightStatusResponse(BaseModel):
    """Response for highlight feature status."""

    enabled: bool
    recording: bool
    bufferSeconds: float = 0
    maxBufferSeconds: int = 60


class HighlightFeatureResponse(BaseModel):
    """Response for feature flag check."""

    enabled: bool


@router.get("/feature", response_model=HighlightFeatureResponse)
async def get_feature_status(
    user: TokenPayload = Depends(get_current_user),
) -> HighlightFeatureResponse:
    """Check if highlight feature is enabled.

    This endpoint allows the frontend to conditionally show/hide
    the highlight button based on the server-side feature flag.
    """
    log.debug("GET /highlight/feature request")
    return HighlightFeatureResponse(enabled=settings.highlight_enabled)


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
        # Try to start recording for this channel (supports both ErsatzTV and Dispatcharr)
        from app.services.highlight import get_stream_url

        stream_url = get_stream_url(channel_id)
        if stream_url:
            log.info("Auto-starting highlight recording for channel {}", channel_id)
            started = await highlight_service.start_recording(channel_id, stream_url)
            if started:
                # Refresh status after starting
                status = highlight_service.get_status(channel_id)

    return HighlightStatusResponse(
        enabled=status["enabled"],
        recording=status["recording"],
        bufferSeconds=status.get("bufferSeconds", 0),
        maxBufferSeconds=status.get("maxBufferSeconds", settings.highlight_buffer_seconds),
    )


@router.post("/{channel_id}")
async def save_highlight(
    channel_id: ChannelId = Path(..., description="Channel ID to save highlight for"),
    format: Literal["mp4", "webm"] = Query("mp4", description="Output format: mp4 or webm"),
    start_time: float | None = Query(
        None, ge=0, description="Start time in seconds from beginning of buffer"
    ),
    end_time: float | None = Query(
        None, ge=0, description="End time in seconds from beginning of buffer"
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
        channel_id, format=format, start_time=start_time, end_time=end_time
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
