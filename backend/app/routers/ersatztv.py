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
from app.services.ersatztv import (
    get_channel_by_id,
    get_channels,
    get_current_programme,
    get_programmes_by_channel,
)
from app.services.ersatztv.hls_rewriter import (
    UpstreamProtocolError,
    decode_url,
    fetch_ersatztv,
    is_ersatztv_media_url,
    rewrite_manifest,
    segment_media_type,
)
from app.services.ersatztv.refresh import FeedUnavailableError, run_feed_lookup
from app.services.logo_proxy import fetch_logo
from app.services.tls import SSL_CONTEXT

router = APIRouter(prefix="/api/ersatztv", tags=["ersatztv"])
log = logger.bind(router="ersatztv")

STREAM_STARTUP_SECONDS = 30
STREAM_STARTUP_ATTEMPTS = 8

# Cap on a proxied segment body so a hostile or oversized upstream response
# cannot exhaust process memory. HLS segments are seconds of video.
MAX_SEGMENT_BYTES = 64 * 1024 * 1024

# ErsatzTV being down or slow answers 503; anything else is our bug, logged with
# its traceback and answered 500 so it can't pass for an outage
UPSTREAM_ERRORS = (httpx.HTTPError, TimeoutError, FeedUnavailableError)


def _decode(encoded_url: str, kind: str) -> str:
    """Decode a client-supplied URL; malformed base64 or UTF-8 is a 400."""
    try:
        return decode_url(encoded_url)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {kind} URL") from None


def _internal_error() -> HTTPException:
    return HTTPException(status_code=500, detail="Internal server error")


@router.get("/channels", response_model=EPGChannelResponse)
async def list_channels(user=Depends(get_current_user)) -> EPGChannelResponse:
    """Get all ErsatzTV channels."""
    log.debug("GET /channels request")
    try:
        channels = await run_feed_lookup(get_channels)
        log.debug("Returning {} channels", len(channels))
        return EPGChannelResponse(channels=channels)
    except UPSTREAM_ERRORS as e:
        log.error("Failed to get channels: {}", e)
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None
    except Exception:
        log.exception("Failed to get channels")
        raise _internal_error() from None


@router.get("/programmes/{channel_id}", response_model=ProgrammeListResponse)
async def list_programmes(
    channel_id: str = Path(...),
    hours: int = Query(default=6, ge=1, le=168),  # Up to 7 days
    user=Depends(get_current_user),
) -> ProgrammeListResponse:
    """Get programmes for channel within time window."""
    log.debug("GET /programmes request for channel: {}", channel_id)
    try:
        programmes = await run_feed_lookup(get_programmes_by_channel, channel_id, hours=hours)
        log.debug("Returning {} programmes for channel {}", len(programmes), channel_id)
        return ProgrammeListResponse(channel_id=channel_id, programmes=programmes)
    except UPSTREAM_ERRORS as e:
        log.error("Failed to get programmes for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None
    except Exception:
        log.exception("Failed to get programmes for channel {}", channel_id)
        raise _internal_error() from None


@router.get("/current/{channel_id}", response_model=CurrentProgrammeResponse)
async def get_current(
    channel_id: str = Path(...),
    user=Depends(get_current_user),
) -> CurrentProgrammeResponse:
    """Get current and next programme for channel."""
    log.debug("GET /current request for channel: {}", channel_id)
    try:
        current, next_up = await run_feed_lookup(get_current_programme, channel_id)
        return CurrentProgrammeResponse(
            channel_id=channel_id,
            current=current,
            next_up=next_up,
        )
    except UPSTREAM_ERRORS as e:
        log.error("Failed to get current programme for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None
    except Exception:
        log.exception("Failed to get current programme for channel {}", channel_id)
        raise _internal_error() from None


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
            manifest_url = _decode(url, "stream")
        else:
            channel = await run_feed_lookup(get_channel_by_id, channel_id)
            if not channel:
                raise HTTPException(status_code=404, detail="Channel not found")
            manifest_url = channel.stream_url

        if not is_ersatztv_media_url(manifest_url, playlist=True):
            raise HTTPException(status_code=400, detail="Invalid stream URL")

        return Response(
            status_code=200,
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except HTTPException:
        raise
    except UPSTREAM_ERRORS as e:
        log.error("Stream HEAD error for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="Stream unavailable") from None
    except Exception:
        log.exception("Stream HEAD error for channel {}", channel_id)
        raise _internal_error() from None


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
            manifest_url = _decode(url, "stream")
        else:
            # Initial request - get channel stream URL
            channel = await run_feed_lookup(get_channel_by_id, channel_id)
            if not channel:
                raise HTTPException(status_code=404, detail="Channel not found")
            manifest_url = channel.stream_url

        # Validate URL is from ErsatzTV
        if not is_ersatztv_media_url(manifest_url, playlist=True):
            raise HTTPException(status_code=400, detail="Invalid stream URL")

        # Fetch manifest with retry for cold stream startup
        # ErsatzTV needs time to initialize transcoding on first access.
        # follow_redirects is disabled so fetch_ersatztv can re-validate every
        # hop against the allowlist; an off-host redirect or a non-HLS reply
        # raises UpstreamProtocolError, answered 502 rather than retried.
        async with (
            asyncio.timeout(STREAM_STARTUP_SECONDS),
            httpx.AsyncClient(follow_redirects=False, timeout=10, verify=SSL_CONTEXT) as client,
        ):
            last_error: Exception | None = None
            response: httpx.Response | None = None

            for attempt in range(STREAM_STARTUP_ATTEMPTS):
                try:
                    response = await fetch_ersatztv(client, manifest_url, stream=False)
                    response.raise_for_status()
                    if response.text.strip():  # Got valid content
                        break
                except (httpx.HTTPStatusError, httpx.TransportError, TimeoutError) as e:
                    last_error = e
                if attempt < STREAM_STARTUP_ATTEMPTS - 1:
                    # A cold nested playlist may need three four-second
                    # segments before it exists. Also back off empty 200s.
                    delay = min(0.5 * (2**attempt), 4)
                    log.debug(
                        "Stream retry {}/{} for {}, waiting {}s",
                        attempt + 1,
                        STREAM_STARTUP_ATTEMPTS,
                        channel_id,
                        delay,
                    )
                    await asyncio.sleep(delay)
            else:
                log.warning("Stream startup retries exhausted for {}", channel_id)
                raise HTTPException(
                    status_code=503, detail="Stream unavailable - cold start timeout"
                ) from last_error

        # Rewrite manifest with token for segment auth
        # Use final URL after redirects for correct base path
        final_url = str(response.url)
        rewritten = rewrite_manifest(response.text, final_url, token=token, channel_id=channel_id)

        return StreamingResponse(
            iter([rewritten.encode()]),
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Access-Control-Allow-Origin": "*",  # Chromecast needs CORS
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "X-Content-Type-Options": "nosniff",
            },
        )

    except HTTPException:
        raise
    except UpstreamProtocolError as e:
        log.warning("Stream for channel {} rejected: {}", channel_id, e)
        raise HTTPException(status_code=502, detail=str(e)) from None
    except UPSTREAM_ERRORS as e:
        log.error("Stream error for channel {}: {}: {}", channel_id, type(e).__name__, e)
        raise HTTPException(status_code=503, detail="Stream unavailable") from None
    except Exception:
        log.exception("Stream error for channel {}", channel_id)
        raise _internal_error() from None


@router.head("/segments/{encoded_url:path}")
async def head_segment(
    encoded_url: str = Path(...),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """HEAD request for segment - returns headers only."""
    log.debug("HEAD /segments request")
    try:
        segment_url = _decode(encoded_url, "segment")

        if not is_ersatztv_media_url(segment_url):
            raise HTTPException(status_code=400, detail="Invalid segment URL")

        return Response(
            status_code=200,
            media_type="video/mp2t",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except HTTPException:
        raise
    except UPSTREAM_ERRORS as e:
        log.error("Segment HEAD error: {}", e)
        raise HTTPException(status_code=503, detail="Segment unavailable") from None
    except Exception:
        log.exception("Segment HEAD error")
        raise _internal_error() from None


@router.get("/segments/{encoded_url:path}")
async def get_segment(
    encoded_url: str = Path(...),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """Proxy HLS segment from ErsatzTV."""
    log.debug("GET /segments request")
    try:
        segment_url = _decode(encoded_url, "segment")

        # Validate URL is from ErsatzTV
        if not is_ersatztv_media_url(segment_url):
            raise HTTPException(status_code=400, detail="Invalid segment URL")

        # Stream the body through instead of buffering it - a segment must never
        # be materialised in memory, whatever size the upstream claims to send.
        # follow_redirects is disabled so fetch_ersatztv can re-validate every
        # redirect hop against the allowlist.
        client = httpx.AsyncClient(follow_redirects=False, timeout=30, verify=SSL_CONTEXT)
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

        # Serve only media types: anything else (an HTML error page, say) goes
        # out as video/mp2t with nosniff, never as a document on our origin
        content_type = segment_media_type(response.headers.get("content-type"))

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
                # Propagate so ASGI aborts framing; a clean EOF would certify corrupt media.
                log.error("Upstream failure mid-segment, aborting stream: {}", e)
                raise
            finally:
                await response.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_segment(),
            media_type=content_type,
            headers={
                "Access-Control-Allow-Origin": "*",  # Chromecast needs CORS
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "X-Content-Type-Options": "nosniff",
            },
        )

    except HTTPException:
        raise
    except UpstreamProtocolError as e:
        log.warning("Segment rejected: {}", e)
        raise HTTPException(status_code=502, detail=str(e)) from None
    except UPSTREAM_ERRORS as e:
        log.error("Segment error: {}", e)
        raise HTTPException(status_code=503, detail="Segment unavailable") from None
    except Exception:
        log.exception("Segment error")
        raise _internal_error() from None


@router.get("/logos/{channel_id}")
async def get_logo(
    channel_id: str = Path(...),
    # No auth required - logos are public images proxied from ErsatzTV
    # Browser img tags cannot send Authorization headers
):
    """Proxy channel logo from ErsatzTV."""
    log.debug("GET /logos request for channel: {}", channel_id)
    try:
        channel = await run_feed_lookup(get_channel_by_id, channel_id)
        if not channel:
            raise HTTPException(status_code=404, detail="Channel not found")

        logo_url = getattr(channel, "original_logo_url", None) or channel.logo_url
        if not logo_url:
            raise HTTPException(status_code=404, detail="No logo available")

        async with httpx.AsyncClient(
            follow_redirects=False, timeout=10, verify=SSL_CONTEXT
        ) as client:
            body, content_type = await fetch_logo(client, logo_url)

        return Response(
            body,
            media_type=content_type,
            headers={
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "X-Content-Type-Options": "nosniff",
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Logo error for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="Logo unavailable") from None
