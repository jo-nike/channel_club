"""ErsatzTV API endpoints.

Provides REST API for ErsatzTV channel and programme data,
plus HLS stream proxying and logo serving.

Story: 7.6 - ErsatzTV API Endpoints
"""

import asyncio
import re
from collections.abc import AsyncIterator
from time import monotonic

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from fastapi.responses import StreamingResponse
from loguru import logger
from starlette.requests import ClientDisconnect
from starlette.types import Receive, Scope, Send

from app.models.auth import TokenPayload
from app.models.base import CamelModel
from app.models.channel import ChannelId
from app.models.ersatztv import (
    CurrentProgrammeResponse,
    EPGChannelResponse,
    ProgrammeListResponse,
    PublicEPGChannel,
)
from app.routers.auth_deps import get_current_user, get_current_user_or_token
from app.services import stream_sessions
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
from app.services.http_clients import ersatztv_client
from app.services.logo_proxy import (
    LOGO_CACHE,
    LOGO_CACHE_CONTROL,
    LOGO_NOT_FOUND_CACHE_CONTROL,
    LogoNotFoundError,
    LogoUnavailableError,
    fetch_logo,
)
from app.services.stream_sessions import StreamSession, StreamSessionLimitError

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


async def _client_gone(request: Request) -> bool:
    """True once the client has disconnected.

    Starlette's check reads a single message, and a GET's empty http.request
    message comes first, so read the body (capped by the body-limit
    middleware) before asking.
    """
    try:
        await request.body()
    except ClientDisconnect:
        return True
    return await request.is_disconnected()


@router.get("/channels", response_model=EPGChannelResponse)
async def list_channels(user=Depends(get_current_user)) -> EPGChannelResponse:
    """Get all ErsatzTV channels."""
    log.debug("GET /channels request")
    try:
        channels = await run_feed_lookup(get_channels)
        log.debug("Returning {} channels", len(channels))
        return EPGChannelResponse(channels=[PublicEPGChannel.from_channel(c) for c in channels])
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
        programmes = await get_programmes_by_channel(channel_id, hours=hours)
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
        current, next_up = await get_current_programme(channel_id)
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


# Playlists and segments: the Chromecast fetches them cross-origin, and neither
# is ever a document on our origin
STREAM_HEADERS = {
    "Access-Control-Allow-Origin": "*",  # Chromecast needs CORS
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
}


class _SegmentResponse(StreamingResponse):
    """A proxied segment that closes its upstream response however it ends.

    The body generator's finally only runs once iteration starts; a client that
    leaves before the headers go out would otherwise keep the connection
    checked out of the shared ErsatzTV pool for good.
    """

    def __init__(self, upstream: httpx.Response, content: AsyncIterator[bytes], media_type: str):
        super().__init__(content, media_type=media_type, headers=STREAM_HEADERS)
        self.upstream = upstream

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            await self.upstream.aclose()


async def _manifest_url(channel_id: str, url: str | None) -> str:
    """The upstream playlist to fetch: a nested playlist's URL or the channel's."""
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
    return manifest_url


async def _head_stream(channel_id: str, url: str | None) -> Response:
    """Headers only for a playlist (for video.js preflight)."""
    try:
        await _manifest_url(channel_id, url)
        return Response(
            status_code=200,
            media_type="application/vnd.apple.mpegurl",
            headers=STREAM_HEADERS,
        )
    except HTTPException:
        raise
    except UPSTREAM_ERRORS as e:
        log.error("Stream HEAD error for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="Stream unavailable") from None
    except Exception:
        log.exception("Stream HEAD error for channel {}", channel_id)
        raise _internal_error() from None


async def _get_stream(
    request: Request,
    channel_id: str,
    url: str | None,
    *,
    token: str | None = None,
    session_id: str | None = None,
) -> StreamingResponse:
    """Fetch, rewrite and serve a playlist.

    If `url` is given, fetches that URL (for nested playlists). Otherwise
    fetches the channel's stream_url from M3U data. With a session, every
    rewritten URL goes through the session's routes; without one, the token is
    passed through to rewritten URLs for HLS auth (the legacy routes).
    """
    started = monotonic()
    attempts = 0
    try:
        manifest_url = await _manifest_url(channel_id, url)

        # Fetch manifest with retry for cold stream startup
        # ErsatzTV needs time to initialize transcoding on first access.
        # The shared client doesn't follow redirects, so fetch_ersatztv can
        # re-validate every hop against the allowlist; an off-host redirect or a
        # non-HLS reply raises UpstreamProtocolError, answered 502 rather than retried.
        client = ersatztv_client()
        async with asyncio.timeout(STREAM_STARTUP_SECONDS):
            last_error: Exception | None = None
            response: httpx.Response | None = None

            for attempt in range(STREAM_STARTUP_ATTEMPTS):
                attempts = attempt + 1
                try:
                    response = await fetch_ersatztv(client, manifest_url, stream=False, timeout=10)
                    response.raise_for_status()
                    if response.text.strip():  # Got valid content
                        break
                except (httpx.HTTPStatusError, httpx.TransportError, TimeoutError) as e:
                    last_error = e
                if attempt < STREAM_STARTUP_ATTEMPTS - 1:
                    # hls.js gives up on a slow playlist and asks again; don't
                    # keep a loop running on ErsatzTV for a client that left
                    if await _client_gone(request):
                        log.debug("Client left during stream startup for {}", channel_id)
                        raise HTTPException(status_code=499, detail="Client closed request")
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

        # Rewrite every URL through the session's routes, or the legacy
        # routes with the token. Use final URL after redirects for correct base path
        final_url = str(response.url)
        if session_id:
            rewritten = rewrite_manifest(response.text, final_url, session_id=session_id)
        else:
            rewritten = rewrite_manifest(
                response.text, final_url, token=token, channel_id=channel_id
            )

        return StreamingResponse(
            iter([rewritten.encode()]),
            media_type="application/vnd.apple.mpegurl",
            headers=STREAM_HEADERS,
        )

    except HTTPException:
        raise
    except UpstreamProtocolError as e:
        log.warning("Stream for channel {} rejected: {}", channel_id, e)
        raise HTTPException(status_code=502, detail=str(e)) from None
    except UPSTREAM_ERRORS as e:
        # Name the step: a wall-clock TimeoutError carries no message of its own
        step = f"manifest fetch attempt {attempts}/{STREAM_STARTUP_ATTEMPTS}"
        log.warning(
            "Stream error for channel {}: {} failed after {:.1f}s: {}: {}",
            channel_id,
            step if attempts else "channel lookup",
            monotonic() - started,
            type(e).__name__,
            str(e) or "no detail",
        )
        raise HTTPException(status_code=503, detail="Stream unavailable") from None
    except Exception:
        log.exception("Stream error for channel {}", channel_id)
        raise _internal_error() from None


async def _head_segment(encoded_url: str) -> Response:
    """Headers only for a segment."""
    try:
        segment_url = _decode(encoded_url, "segment")

        if not is_ersatztv_media_url(segment_url):
            raise HTTPException(status_code=400, detail="Invalid segment URL")

        return Response(status_code=200, media_type="video/mp2t", headers=STREAM_HEADERS)
    except HTTPException:
        raise
    except UPSTREAM_ERRORS as e:
        log.error("Segment HEAD error: {}", e)
        raise HTTPException(status_code=503, detail="Segment unavailable") from None
    except Exception:
        log.exception("Segment HEAD error")
        raise _internal_error() from None


async def _get_segment(encoded_url: str) -> StreamingResponse:
    """Proxy an HLS segment from ErsatzTV."""
    try:
        segment_url = _decode(encoded_url, "segment")

        # Validate URL is from ErsatzTV
        if not is_ersatztv_media_url(segment_url):
            raise HTTPException(status_code=400, detail="Invalid segment URL")

        # Stream the body through instead of buffering it - a segment must never
        # be materialised in memory, whatever size the upstream claims to send.
        # The shared client doesn't follow redirects, so fetch_ersatztv can
        # re-validate every redirect hop against the allowlist. Only the
        # response is ever closed here, never the shared client.
        response = await fetch_ersatztv(ersatztv_client(), segment_url, stream=True, timeout=30)
        try:
            response.raise_for_status()
        except BaseException:
            await response.aclose()
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

        return _SegmentResponse(response, stream_segment(), content_type)

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


@router.head("/stream/{channel_id}")
async def head_stream(
    channel_id: str = Path(...),
    url: str = Query(default=None),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """HEAD request for stream - returns headers only (for video.js preflight)."""
    log.debug("HEAD /stream request for channel: {}", channel_id)
    return await _head_stream(channel_id, url)


@router.get("/stream/{channel_id}")
async def get_stream(
    request: Request,
    channel_id: str = Path(...),
    url: str = Query(default=None),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """Get proxied HLS manifest for channel (legacy ?token= route, removed in R4).

    If `url` query param is provided, fetches that URL (for nested playlists).
    Otherwise fetches the channel's stream_url from M3U data.
    Token is passed through to rewritten segment URLs for HLS auth.
    """
    log.debug("GET /stream request for channel: {}", channel_id)
    return await _get_stream(request, channel_id, url, token=token)


@router.head("/segments/{encoded_url:path}")
async def head_segment(
    encoded_url: str = Path(...),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """HEAD request for segment - returns headers only."""
    log.debug("HEAD /segments request")
    return await _head_segment(encoded_url)


@router.get("/segments/{encoded_url:path}")
async def get_segment(
    encoded_url: str = Path(...),
    token: str = Query(default=None),
    user=Depends(get_current_user_or_token),
):
    """Proxy HLS segment from ErsatzTV (legacy ?token= route, removed in R4)."""
    log.debug("GET /segments request")
    return await _get_segment(encoded_url)


class StreamSessionRequest(CamelModel):
    """Request to open a stream session for a channel."""

    channel_id: ChannelId


class StreamSessionResponse(CamelModel):
    """A stream session: play `url`, which carries no credential."""

    session_id: str
    url: str


_SESSION_ID = re.compile(r"[A-Za-z0-9_-]{32}")


def _live_session(session_id: str) -> StreamSession:
    """The session a request names, kept alive by that request; else a 404.

    Checked before anything reaches ErsatzTV. The session id is the capability:
    the session routes take no token, so no credential is ever in their URLs.
    """
    session = stream_sessions.get(session_id) if _SESSION_ID.fullmatch(session_id) else None
    if session is None:
        raise HTTPException(status_code=404, detail="Stream session not found")
    return session


@router.post("/session", response_model=StreamSessionResponse)
async def create_stream_session(
    body: StreamSessionRequest,
    # Authorization header only: a query token must not work here
    user: TokenPayload = Depends(get_current_user),
) -> StreamSessionResponse:
    """Open a stream session for a channel and return the playlist URL to play."""
    log.debug("POST /session request for channel: {}", body.channel_id)
    try:
        channel = await run_feed_lookup(get_channel_by_id, body.channel_id)
        if not channel:
            raise HTTPException(status_code=404, detail="Channel not found")
        session = stream_sessions.create(user.account_key, body.channel_id)
    except HTTPException:
        raise
    except StreamSessionLimitError:
        log.warning("Stream session limit reached")
        raise HTTPException(status_code=429, detail="Too many open streams") from None
    except UPSTREAM_ERRORS as e:
        log.error("Failed to open a stream session for channel {}: {}", body.channel_id, e)
        raise HTTPException(status_code=503, detail="ErsatzTV service unavailable") from None
    except Exception:
        log.exception("Failed to open a stream session for channel {}", body.channel_id)
        raise _internal_error() from None
    return StreamSessionResponse(
        session_id=session.id, url=stream_sessions.manifest_path(session.id)
    )


# The .m3u8 suffix lets Vidstack recognise HLS without probing
@router.head("/s/{session_id}/stream.m3u8")
async def head_session_stream(
    session_id: str = Path(...),
    url: str = Query(default=None),
):
    """HEAD request for a session's playlist - returns headers only."""
    session = _live_session(session_id)
    log.debug("HEAD session stream request for channel: {}", session.channel_id)
    return await _head_stream(session.channel_id, url)


@router.get("/s/{session_id}/stream.m3u8")
async def get_session_stream(
    request: Request,
    session_id: str = Path(...),
    url: str = Query(default=None),
):
    """Get a session's proxied HLS manifest (a nested playlist when `url` is given)."""
    session = _live_session(session_id)
    log.debug("GET session stream request for channel: {}", session.channel_id)
    return await _get_stream(request, session.channel_id, url, session_id=session.id)


@router.head("/s/{session_id}/segments/{encoded_url:path}")
async def head_session_segment(
    session_id: str = Path(...),
    encoded_url: str = Path(...),
):
    """HEAD request for a session's segment - returns headers only."""
    _live_session(session_id)
    log.debug("HEAD session segment request")
    return await _head_segment(encoded_url)


@router.get("/s/{session_id}/segments/{encoded_url:path}")
async def get_session_segment(
    session_id: str = Path(...),
    encoded_url: str = Path(...),
):
    """Proxy a session's HLS segment from ErsatzTV."""
    _live_session(session_id)
    log.debug("GET session segment request")
    return await _get_segment(encoded_url)


@router.get("/logos/{channel_id}")
async def get_logo(
    channel_id: str = Path(...),
    # No auth required - logos are public images proxied from ErsatzTV
    # Browser img tags cannot send Authorization headers
):
    """Proxy channel logo from ErsatzTV, cached in the shared logo cache."""
    log.debug("GET /logos request for channel: {}", channel_id)
    try:
        channel = await run_feed_lookup(get_channel_by_id, channel_id)
        if not channel:
            raise HTTPException(status_code=404, detail="Channel not found")

        logo_url = getattr(channel, "original_logo_url", None) or channel.logo_url
        if not logo_url:
            raise HTTPException(status_code=404, detail="No logo available")

        async def fetch() -> tuple[bytes, str]:
            # The shared client's 10 s default timeout applies
            return await fetch_logo(ersatztv_client(), logo_url)

        # Keyed by the upstream URL too, so a channel's changed logo misses
        body, content_type = await LOGO_CACHE.get(
            f"ersatztv:{channel_id}:{logo_url}", fetch, not_found_ttl=LOGO_CACHE.ttl
        )

        return Response(
            body,
            media_type=content_type,
            headers={
                "Cache-Control": LOGO_CACHE_CONTROL,
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "X-Content-Type-Options": "nosniff",
            },
        )

    except HTTPException:
        raise
    except LogoNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="No logo available",
            headers={"Cache-Control": LOGO_NOT_FOUND_CACHE_CONTROL},
        ) from None
    except LogoUnavailableError:
        # LOGO_CACHE logged the cause once for this logo
        raise HTTPException(status_code=503, detail="Logo unavailable") from None
    except UPSTREAM_ERRORS as e:
        # A catalogue outage is logged by the feed refresh; one line per request is noise
        log.debug("Logo lookup failed for channel {}: {}", channel_id, e)
        raise HTTPException(status_code=503, detail="Logo unavailable") from None
    except Exception:
        log.exception("Logo error for channel {}", channel_id)
        raise _internal_error() from None
