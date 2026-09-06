"""ErsatzTV API endpoints.

Provides REST API for ErsatzTV channel and programme data,
plus HLS stream proxying and logo serving.

Story: 7.6 - ErsatzTV API Endpoints
"""

import asyncio
from collections.abc import AsyncIterator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from fastapi.responses import StreamingResponse
from loguru import logger

from app.models.ersatztv import (
    CurrentProgrammeResponse,
    EPGChannelResponse,
    ProgrammeListResponse,
)
from app.routers.auth_deps import get_current_user, get_current_user_or_token
from app.services.bounded_http import LOGO_BYTES, read_bounded
from app.services.ersatztv import (
    get_channel_by_id,
    get_channels,
    get_current_programme,
    get_programmes_by_channel,
)
from app.services.ersatztv.hls_rewriter import (
    decode_url,
    fetch_ersatztv,
    is_ersatztv_url,
    rewrite_manifest,
)

router = APIRouter(prefix="/api/ersatztv", tags=["ersatztv"])
log = logger.bind(router="ersatztv")

# Cap on a proxied segment body so a hostile or oversized upstream response
# cannot exhaust process memory. HLS segments are seconds of video.
MAX_SEGMENT_BYTES = 64 * 1024 * 1024


@router.get("/channels", response_model=EPGChannelResponse)
async def list_channels(user=Depends(get_current_user)) -> EPGChannelResponse:
    """Get all ErsatzTV channels."""
    log.debug("GET /channels request")
    try:
        channels = await asyncio.to_thread(get_channels)
        log.debug("Returning {} channels", len(channels))
        return EPGChannelResponse(channels=channels)
    except Exception as e:
        log.error("Failed to get channels: {}", e)
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None


@router.get("/programmes/{channel_id}", response_model=ProgrammeListResponse)
async def list_programmes(
    channel_id: str = Path(...),
    hours: int = Query(default=6, ge=1, le=168),  # Up to 7 days
    user=Depends(get_current_user),
) -> ProgrammeListResponse:
    """Get programmes for channel within time window."""
    log.debug("GET /programmes request for channel: {}", channel_id)
    try:
        programmes = await asyncio.to_thread(get_programmes_by_channel, channel_id, hours=hours)
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
        current, next_up = await asyncio.to_thread(get_current_programme, channel_id)
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
            channel = await asyncio.to_thread(get_channel_by_id, channel_id)
            if not channel:
                raise HTTPException(status_code=404, detail="Channel not found")
            manifest_url = channel.stream_url

        if not is_ersatztv_url(manifest_url):
            raise HTTPException(status_code=400, detail="Invalid stream URL")

        return Response(
            status_code=200,
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Access-Control-Allow-Origin": "*",
            },
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
            channel = await asyncio.to_thread(get_channel_by_id, channel_id)
            if not channel:
                raise HTTPException(status_code=404, detail="Channel not found")
            manifest_url = channel.stream_url

        # Validate URL is from ErsatzTV
        if not is_ersatztv_url(manifest_url):
            raise HTTPException(status_code=400, detail="Invalid stream URL")

        # Fetch manifest with retry for cold stream startup
        # ErsatzTV needs time to initialize transcoding on first access.
        # follow_redirects is disabled so fetch_ersatztv can re-validate every
        # hop against the allowlist; an off-host redirect raises ValueError,
        # which propagates to the outer handler as a 503 rather than being
        # retried.
        async with httpx.AsyncClient(follow_redirects=False, timeout=10) as client:
            last_error: Exception | None = None
            response: httpx.Response | None = None

            for attempt in range(5):
                try:
                    response = await fetch_ersatztv(client, manifest_url, stream=False)
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

        content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
        if content_type and content_type not in {
            "application/vnd.apple.mpegurl",
            "application/x-mpegurl",
            "audio/mpegurl",
            "audio/x-mpegurl",
            "text/plain",
            "application/octet-stream",
        }:
            raise HTTPException(status_code=502, detail="Upstream is not an HLS manifest")
        if not response.text.lstrip("\ufeff").startswith("#EXTM3U"):
            raise HTTPException(status_code=502, detail="Invalid HLS manifest")

        # Rewrite manifest with token for segment auth
        # Use final URL after redirects for correct base path
        final_url = str(response.url)
        rewritten = rewrite_manifest(response.text, final_url, token=token, channel_id=channel_id)

        return StreamingResponse(
            iter([rewritten.encode()]),
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Access-Control-Allow-Origin": "*",  # Chromecast needs CORS
            },
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

        if not is_ersatztv_url(segment_url):
            raise HTTPException(status_code=400, detail="Invalid segment URL")

        return Response(
            status_code=200,
            media_type="video/mp2t",
            headers={
                "Access-Control-Allow-Origin": "*",
            },
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
        if not is_ersatztv_url(segment_url):
            raise HTTPException(status_code=400, detail="Invalid segment URL")

        # Stream the body through instead of buffering it - a segment must never
        # be materialised in memory, whatever size the upstream claims to send.
        # follow_redirects is disabled so fetch_ersatztv can re-validate every
        # redirect hop against the allowlist.
        client = httpx.AsyncClient(follow_redirects=False, timeout=30)
        try:
            response = await fetch_ersatztv(client, segment_url, stream=True)
            try:
                response.raise_for_status()
            except BaseException:
                await response.aclose()
                raise
        except BaseException:
            await client.aclose()
            raise

        # Determine content type
        content_type = response.headers.get("content-type", "video/mp2t")

        # Reject an oversized segment up-front, while we can still send a real
        # status code. A silent truncation would present a corrupt body as 200.
        declared_length = response.headers.get("content-length")
        if declared_length is not None:
            try:
                declared_bytes = int(declared_length)
            except ValueError:
                declared_bytes = None
            if declared_bytes is not None and declared_bytes > MAX_SEGMENT_BYTES:
                log.warning(
                    "Segment content-length {} exceeds {} byte cap, rejecting",
                    declared_bytes,
                    MAX_SEGMENT_BYTES,
                )
                await response.aclose()
                await client.aclose()
                raise HTTPException(status_code=502, detail="Segment too large")

        async def stream_segment() -> AsyncIterator[bytes]:
            """Forward upstream chunks, enforcing the size cap on unbounded bodies."""
            sent = 0
            try:
                async for chunk in response.aiter_bytes():
                    sent += len(chunk)
                    if sent > MAX_SEGMENT_BYTES:
                        # Never present a truncated body as a complete segment -
                        # abort the stream instead of silently stopping.
                        log.error("Segment exceeded {} byte cap, aborting", MAX_SEGMENT_BYTES)
                        raise RuntimeError("Segment exceeded size cap")
                    yield chunk
            except httpx.HTTPError as e:
                # Headers are already sent, so a clean 5xx is impossible here.
                # Ending the stream beats leaking a raw traceback to the client.
                log.error("Upstream failure mid-segment, ending stream: {}", e)
                return
            finally:
                await response.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_segment(),
            media_type=content_type,
            headers={
                "Access-Control-Allow-Origin": "*",  # Chromecast needs CORS
            },
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
        channel = await asyncio.to_thread(get_channel_by_id, channel_id)
        if not channel:
            raise HTTPException(status_code=404, detail="Channel not found")

        logo_url = getattr(channel, "original_logo_url", None) or channel.logo_url
        if not logo_url:
            raise HTTPException(status_code=404, detail="No logo available")

        async with httpx.AsyncClient(follow_redirects=False, timeout=10) as client:
            response = await client.send(client.build_request("GET", logo_url), stream=True)
            try:
                response.raise_for_status()
                body = await read_bounded(response, LOGO_BYTES)
            finally:
                await response.aclose()

        content_type = response.headers.get("content-type", "image/png")

        return StreamingResponse(
            iter([body]),
            media_type=content_type,
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Logo error for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="Logo unavailable") from None
