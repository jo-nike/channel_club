"""ErsatzTV API endpoints.

Provides REST API for ErsatzTV channel and programme data,
plus HLS stream proxying and logo serving.

Story: 7.6 - ErsatzTV API Endpoints
"""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import StreamingResponse

from app.config import settings
from app.models.ersatztv import (
    CurrentProgrammeResponse,
    EPGChannelResponse,
    ProgrammeListResponse,
)
from app.routers.auth_deps import get_current_user, get_current_user_or_token
from app.services.ersatztv import (
    get_channel_by_id,
    get_channels,
    get_current_programme,
    get_programmes_by_channel,
)
from app.services.ersatztv.hls_rewriter import decode_url, rewrite_manifest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ersatztv", tags=["ersatztv"])


@router.get("/channels", response_model=EPGChannelResponse)
async def list_channels(user=Depends(get_current_user)) -> EPGChannelResponse:
    """Get all ErsatzTV channels."""
    try:
        channels = get_channels()
        return EPGChannelResponse(channels=channels)
    except Exception as e:
        logger.error(f"Failed to get channels: {e}")
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None


@router.get("/programmes/{channel_id}", response_model=ProgrammeListResponse)
async def list_programmes(
    channel_id: str = Path(...),
    hours: int = Query(default=6, ge=1, le=24),
    user=Depends(get_current_user),
) -> ProgrammeListResponse:
    """Get programmes for channel within time window."""
    try:
        programmes = get_programmes_by_channel(channel_id, hours=hours)
        return ProgrammeListResponse(channel_id=channel_id, programmes=programmes)
    except Exception as e:
        logger.error(f"Failed to get programmes: {e}")
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None


@router.get("/current/{channel_id}", response_model=CurrentProgrammeResponse)
async def get_current(
    channel_id: str = Path(...),
    user=Depends(get_current_user),
) -> CurrentProgrammeResponse:
    """Get current and next programme for channel."""
    try:
        current, next_up = get_current_programme(channel_id)
        return CurrentProgrammeResponse(
            channel_id=channel_id,
            current=current,
            next_up=next_up,
        )
    except Exception as e:
        logger.error(f"Failed to get current programme: {e}")
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None


@router.get("/stream/{channel_id}")
async def get_stream(
    channel_id: str = Path(...),
    url: str = Query(default=None),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """Get proxied HLS manifest for channel.

    If `url` query param is provided, fetches that URL (for nested playlists).
    Otherwise fetches the channel's stream_url from M3U data.
    Token is passed through to rewritten segment URLs for HLS auth.
    """
    try:
        if url:
            # Nested playlist - decode URL
            manifest_url = decode_url(url)
        else:
            # Initial request - get channel stream URL
            channel = get_channel_by_id(channel_id)
            if not channel:
                raise HTTPException(status_code=404, detail="Channel not found")
            manifest_url = channel.stream_url

        # Validate URL is from ErsatzTV
        if not manifest_url.startswith(settings.ersatztv_base_url):
            raise HTTPException(status_code=400, detail="Invalid stream URL")

        # Fetch manifest
        async with httpx.AsyncClient() as client:
            response = await client.get(manifest_url, timeout=10)
            response.raise_for_status()

        # Rewrite manifest with token for segment auth
        base_url = manifest_url.rsplit("/", 1)[0] + "/"
        rewritten = rewrite_manifest(response.text, base_url, token=token)

        return StreamingResponse(
            iter([rewritten.encode()]),
            media_type="application/vnd.apple.mpegurl",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stream error: {e}")
        raise HTTPException(status_code=503, detail="Stream unavailable") from None


@router.get("/segments/{encoded_url:path}")
async def get_segment(
    encoded_url: str = Path(...),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """Proxy HLS segment from ErsatzTV."""
    try:
        segment_url = decode_url(encoded_url)

        # Validate URL is from ErsatzTV
        if not segment_url.startswith(settings.ersatztv_base_url):
            raise HTTPException(status_code=400, detail="Invalid segment URL")

        async with httpx.AsyncClient() as client:
            response = await client.get(segment_url, timeout=30)
            response.raise_for_status()

        # Determine content type
        content_type = response.headers.get("content-type", "video/mp2t")

        return StreamingResponse(
            iter([response.content]),
            media_type=content_type,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Segment error: {e}")
        raise HTTPException(status_code=503, detail="Segment unavailable") from None


@router.get("/logos/{channel_id}")
async def get_logo(
    channel_id: str = Path(...),
    # No auth required - logos are public images proxied from ErsatzTV
    # Browser img tags cannot send Authorization headers
):
    """Proxy channel logo from ErsatzTV."""
    try:
        channel = get_channel_by_id(channel_id)
        if not channel:
            raise HTTPException(status_code=404, detail="Channel not found")

        logo_url = getattr(channel, "original_logo_url", None) or channel.logo_url
        if not logo_url:
            raise HTTPException(status_code=404, detail="No logo available")

        async with httpx.AsyncClient() as client:
            response = await client.get(logo_url, timeout=10)
            response.raise_for_status()

        content_type = response.headers.get("content-type", "image/png")

        return StreamingResponse(
            iter([response.content]),
            media_type=content_type,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Logo error: {e}")
        raise HTTPException(status_code=503, detail="Logo unavailable") from None
