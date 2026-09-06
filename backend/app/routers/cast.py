"""Chromecast streaming API endpoints.

Provides endpoints for:
- Creating cast sessions (starts HLS transcoding for MPEG-TS streams)
- Stopping cast sessions
- Serving HLS playlist and segment files
- Checking cast feature status
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import FileResponse, Response
from loguru import logger
from pydantic import BaseModel

from app.config import settings
from app.models.auth import TokenPayload
from app.models.channel import ChannelId
from app.routers.auth_deps import get_current_user
from app.services.cast import cast_service
from app.services.media_source import resolve_media_channel

router = APIRouter(prefix="/api/cast", tags=["cast"])
log = logger.bind(router="cast")


class CastFeatureResponse(BaseModel):
    """Response for cast feature status."""

    enabled: bool


class CreateSessionRequest(BaseModel):
    """Request to create a cast session."""

    channel_id: ChannelId
    stream_type: Literal["hls", "mpegts"]


class CastSessionResponse(BaseModel):
    """Response for cast session creation."""

    session_id: str
    hls_url: str
    needs_transcoding: bool


@router.get("/feature", response_model=CastFeatureResponse)
async def get_feature_status(
    user: TokenPayload = Depends(get_current_user),
) -> CastFeatureResponse:
    """Check if cast feature is enabled.

    This endpoint allows the frontend to conditionally show/hide
    the cast button based on the server-side feature flag.
    """
    log.debug("GET /cast/feature request")
    return CastFeatureResponse(enabled=settings.cast_enabled)


@router.post("/session", response_model=CastSessionResponse)
async def create_cast_session(
    request: CreateSessionRequest,
    user: TokenPayload = Depends(get_current_user),
) -> CastSessionResponse:
    """Create a new cast session.

    For HLS streams: Returns the source URL directly (no transcoding needed).
    For MPEG-TS streams: Starts FFmpeg transcoding and returns HLS URL.
    """
    log.info(
        "POST /cast/session request from user {} (channel={}, type={})",
        user.sub,
        request.channel_id,
        request.stream_type,
    )

    if not settings.cast_enabled:
        raise HTTPException(
            status_code=503,
            detail="Cast feature is disabled",
        )

    source = await resolve_media_channel(request.channel_id)

    result = await cast_service.create_session(
        channel_id=request.channel_id,
        stream_url=source.channel.stream_url,
        stream_type=source.stream_type,
        owner=user.sub,
    )

    if not result:
        raise HTTPException(
            status_code=500,
            detail="Failed to create cast session",
        )

    log.info(
        "Cast session {} created for channel {} (transcoding={})",
        result["session_id"],
        request.channel_id,
        result["needs_transcoding"],
    )

    return CastSessionResponse(
        session_id=result["session_id"],
        hls_url=result["hls_url"],
        needs_transcoding=result["needs_transcoding"],
    )


@router.delete("/session/{session_id}")
async def stop_cast_session(
    session_id: str = Path(..., description="Session ID to stop"),
    user: TokenPayload = Depends(get_current_user),
) -> dict:
    """Stop a cast session and cleanup resources."""
    log.info(
        "DELETE /cast/session/{} request from user {}",
        session_id,
        user.sub,
    )

    stopped = await cast_service.stop_session(session_id)

    if not stopped:
        # Session not found - might have already been cleaned up
        log.debug("Cast session {} not found (may have already been cleaned up)", session_id)

    return {"stopped": stopped}


@router.get("/hls/{session_id}/{filename}")
async def get_hls_file(
    session_id: str = Path(..., description="Cast session ID"),
    filename: str = Path(..., description="HLS file (playlist.m3u8 or seg_XXX.ts)"),
) -> Response:
    """Serve HLS playlist or segment files.

    This endpoint is called by the Chromecast device to fetch the HLS stream.
    No auth required - the session_id UUID acts as authentication since it's
    hard to guess and sessions are time-limited. This is necessary because
    Chromecast fetches segments via relative URLs without query params.
    """

    file_path = cast_service.get_file(session_id, filename)

    if not file_path:
        raise HTTPException(
            status_code=404,
            detail=f"File not found: {filename}",
        )

    # Determine media type
    if filename.endswith(".m3u8"):
        media_type = "application/vnd.apple.mpegurl"
    elif filename.endswith(".ts"):
        media_type = "video/mp2t"
    else:
        media_type = "application/octet-stream"

    log.debug("Serving HLS file: {}/{}", session_id, filename)

    return FileResponse(
        path=file_path,
        media_type=media_type,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Access-Control-Allow-Origin": "*",  # Chromecast needs CORS
        },
    )
