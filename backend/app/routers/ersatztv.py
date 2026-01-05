"""ErsatzTV API endpoints.

Provides REST API for ErsatzTV channel and programme data,
plus HLS stream proxying and logo serving.

Story: 7.6 - ErsatzTV API Endpoints
"""

import asyncio

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from fastapi.responses import StreamingResponse
from loguru import logger

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

router = APIRouter(prefix="/api/ersatztv", tags=["ersatztv"])
log = logger.bind(router="ersatztv")


@router.get("/channels", response_model=EPGChannelResponse)
async def list_channels(user=Depends(get_current_user)) -> EPGChannelResponse:
    """Get all ErsatzTV channels."""
    log.debug("GET /channels request")
    try:
        channels = get_channels()
        log.debug("Returning {} channels", len(channels))
        return EPGChannelResponse(channels=channels)
    except Exception as e:
        log.error("Failed to get channels: {}", e)
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None


@router.get("/programmes/{channel_id}", response_model=ProgrammeListResponse)
async def list_programmes(
    channel_id: str = Path(...),
    hours: int = Query(default=6, ge=1, le=24),
    user=Depends(get_current_user),
) -> ProgrammeListResponse:
    """Get programmes for channel within time window."""
    log.debug("GET /programmes request for channel: {}", channel_id)
    try:
        programmes = get_programmes_by_channel(channel_id, hours=hours)
        log.debug("Returning {} programmes for channel {}", len(programmes), channel_id)
        return ProgrammeListResponse(channel_id=channel_id, programmes=programmes)
    except Exception as e:
        log.error("Failed to get programmes for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None


@router.get("/current/{channel_id}", response_model=CurrentProgrammeResponse)
async def get_current(
    channel_id: str = Path(...),
    user=Depends(get_current_user),
) -> CurrentProgrammeResponse:
    """Get current and next programme for channel."""
    log.debug("GET /current request for channel: {}", channel_id)
    try:
        current, next_up = get_current_programme(channel_id)
        return CurrentProgrammeResponse(
            channel_id=channel_id,
            current=current,
            next_up=next_up,
        )
    except Exception as e:
        log.error("Failed to get current programme for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None


@router.head("/stream/{channel_id}")
async def head_stream(
    channel_id: str = Path(...),
    url: str = Query(default=None),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """HEAD request for stream - returns headers only (for video.js preflight)."""
    log.debug("HEAD /stream request for channel: {}", channel_id)
    try:
        if url:
            manifest_url = decode_url(url)
        else:
            channel = get_channel_by_id(channel_id)
            if not channel:
                raise HTTPException(status_code=404, detail="Channel not found")
            manifest_url = channel.stream_url

        if not manifest_url.startswith(settings.ersatztv_base_url):
            raise HTTPException(status_code=400, detail="Invalid stream URL")

        return Response(
            status_code=200,
            media_type="application/vnd.apple.mpegurl",
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("Stream HEAD error for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="Stream unavailable") from None


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
    log.debug("GET /stream request for channel: {}", channel_id)
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

        # Fetch manifest with retry for cold stream startup
        # ErsatzTV needs time to initialize transcoding on first access
        async with httpx.AsyncClient(follow_redirects=True) as client:
            last_error: Exception | None = None
            response: httpx.Response | None = None

            for attempt in range(5):
                try:
                    response = await client.get(manifest_url, timeout=10)
                    response.raise_for_status()
                    if response.text.strip():  # Got valid content
                        break
                except (httpx.HTTPStatusError, httpx.ConnectError) as e:
                    last_error = e
                    if attempt < 4:
                        delay = 0.5 * (2**attempt)  # 0.5s, 1s, 2s, 4s
                        log.debug(
                            "Stream retry {}/{} for {}, waiting {}s",
                            attempt + 1,
                            5,
                            channel_id,
                            delay,
                        )
                        await asyncio.sleep(delay)
            else:
                log.warning("Stream unavailable after 5 retries for {}", channel_id)
                raise HTTPException(
                    status_code=503, detail="Stream unavailable - cold start timeout"
                ) from last_error

        # Rewrite manifest with token for segment auth
        # Use final URL after redirects for correct base path
        final_url = str(response.url)
        base_url = final_url.rsplit("/", 1)[0] + "/"
        rewritten = rewrite_manifest(response.text, base_url, token=token, channel_id=channel_id)

        return StreamingResponse(
            iter([rewritten.encode()]),
            media_type="application/vnd.apple.mpegurl",
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Stream error for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="Stream unavailable") from None


@router.head("/segments/{encoded_url:path}")
async def head_segment(
    encoded_url: str = Path(...),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """HEAD request for segment - returns headers only."""
    log.debug("HEAD /segments request")
    try:
        segment_url = decode_url(encoded_url)

        if not segment_url.startswith(settings.ersatztv_base_url):
            raise HTTPException(status_code=400, detail="Invalid segment URL")

        return Response(
            status_code=200,
            media_type="video/mp2t",
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("Segment HEAD error: {}", e)
        raise HTTPException(status_code=503, detail="Segment unavailable") from None


@router.get("/segments/{encoded_url:path}")
async def get_segment(
    encoded_url: str = Path(...),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """Proxy HLS segment from ErsatzTV."""
    log.debug("GET /segments request")
    try:
        segment_url = decode_url(encoded_url)

        # Validate URL is from ErsatzTV
        if not segment_url.startswith(settings.ersatztv_base_url):
            raise HTTPException(status_code=400, detail="Invalid segment URL")

        async with httpx.AsyncClient(follow_redirects=True) as client:
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
        log.error("Segment error: {}", e)
        raise HTTPException(status_code=503, detail="Segment unavailable") from None


@router.get("/logos/{channel_id}")
async def get_logo(
    channel_id: str = Path(...),
    # No auth required - logos are public images proxied from ErsatzTV
    # Browser img tags cannot send Authorization headers
):
    """Proxy channel logo from ErsatzTV."""
    log.debug("GET /logos request for channel: {}", channel_id)
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
        log.error("Logo error for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="Logo unavailable") from None
