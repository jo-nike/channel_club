"""Status service for monitoring external service health."""

import asyncio
from collections.abc import Coroutine
from datetime import UTC, datetime
from typing import Any

import httpx
from loguru import logger

from app.config import settings
from app.models.status import (
    DispatcharrStream,
    DispatchrrStatus,
    EPGHealthStatus,
    ErsatzTVSession,
    ErsatzTVStatus,
    SystemStatusResponse,
)
from app.services.dispatcharr import (
    DispatchrrUnavailableError,
    dispatcharr_auth_headers,
)
from app.services.epg_service import EPG_HEALTH_NAME, get_epg_service
from app.services.ersatztv import get_guide_health
from app.services.http_clients import dispatcharr_client, ersatztv_client

# Module-level logger with service context
log = logger.bind(service="status")

# Each check in get_system_status reports offline after this long.
STATUS_CHECK_DEADLINE_SECONDS = 5.0


def _reason(exc: BaseException) -> str:
    """Short failure reason for the status panel; str() of a real timeout is ''.

    Uses the same wording as EPGService.refresh_cache.
    """
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, httpx.ConnectError):
        return "connection failed"
    return type(exc).__name__


def _object_list(value: object) -> list[dict]:
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ValueError("Expected a list of objects")
    return value


async def _fetch_ersatztv_data(
    client: httpx.AsyncClient, base_url: str, timeout: float
) -> tuple[list[dict] | None, list[dict], list[dict], str | None]:
    """Fetch sessions, channels, and profiles from ErsatzTV in parallel.

    Args:
        client: httpx client
        base_url: ErsatzTV base URL
        timeout: httpx timeout for each request

    Returns:
        Tuple of (sessions, channels, profiles, sessions_error). Sessions is
        None if fetch failed, and sessions_error then says why.
    """
    sessions_url = f"{base_url}/api/sessions"
    channels_url = f"{base_url}/api/channels"
    profiles_url = f"{base_url}/api/ffmpeg/profiles"

    log.debug("Fetching ErsatzTV data from {}", base_url)

    # Fetch all three endpoints in parallel
    sessions_resp, channels_resp, profiles_resp = await asyncio.gather(
        client.get(sessions_url, timeout=timeout),
        client.get(channels_url, timeout=timeout),
        client.get(profiles_url, timeout=timeout),
        return_exceptions=True,
    )

    # Parse responses - sessions is None if failed, others default to empty
    sessions: list[dict] | None = None
    sessions_error: str | None = None
    channels: list[dict] = []
    profiles: list[dict] = []

    if isinstance(sessions_resp, httpx.Response) and sessions_resp.status_code == 200:
        sessions = _object_list(sessions_resp.json())
    elif isinstance(sessions_resp, httpx.Response):
        sessions_error = f"sessions API HTTP {sessions_resp.status_code}"
    elif isinstance(sessions_resp, Exception):
        log.warning("Failed to fetch ErsatzTV sessions: {}", sessions_resp)
        sessions_error = f"sessions API {_reason(sessions_resp)}"

    if isinstance(channels_resp, httpx.Response) and channels_resp.status_code == 200:
        channels = _object_list(channels_resp.json())
    elif isinstance(channels_resp, Exception):
        log.warning("Failed to fetch ErsatzTV channels: {}", channels_resp)

    if isinstance(profiles_resp, httpx.Response) and profiles_resp.status_code == 200:
        profiles = _object_list(profiles_resp.json())
    elif isinstance(profiles_resp, Exception):
        log.warning("Failed to fetch ErsatzTV profiles: {}", profiles_resp)

    return sessions, channels, profiles, sessions_error


def _build_ersatztv_sessions(
    sessions_data: list[dict],
    channels_data: list[dict],
    profiles_data: list[dict],
    now: datetime,
) -> list[ErsatzTVSession]:
    """Build enriched ErsatzTV session objects by joining data.

    Args:
        sessions_data: Raw session data from /api/sessions
        channels_data: Channel data from /api/channels
        profiles_data: FFmpeg profile data from /api/ffmpeg/profiles
        now: Current timestamp for buffer calculation

    Returns:
        List of enriched ErsatzTVSession objects
    """
    # Build lookup maps
    # channels_data has "number" as int, sessions have "channelNumber" as string
    channel_by_number: dict[str, dict] = {str(ch.get("number", "")): ch for ch in channels_data}
    profile_by_name: dict[str, dict] = {p.get("name", ""): p for p in profiles_data}

    sessions: list[ErsatzTVSession] = []
    for session in sessions_data:
        channel_num = str(session.get("channelNumber", ""))
        channel = channel_by_number.get(channel_num, {})
        profile_name = channel.get("ffmpegProfile", "")
        profile = profile_by_name.get(profile_name, {})

        # Calculate buffer seconds from transcodedUntil
        buffer_seconds: float | None = None
        transcoded_until = session.get("transcodedUntil")
        if transcoded_until:
            try:
                # Parse ISO timestamp with timezone
                transcoded_dt = datetime.fromisoformat(transcoded_until.replace("Z", "+00:00"))
                buffer_seconds = (transcoded_dt - now).total_seconds()
            except (ValueError, TypeError) as e:
                log.debug("Failed to parse transcodedUntil: {}", e)

        sessions.append(
            ErsatzTVSession(
                channel_number=int(channel_num) if channel_num.isdigit() else 0,
                channel_name=channel.get("name"),
                state=session.get("state"),
                buffer_seconds=buffer_seconds,
                streaming_mode=channel.get("streamingMode"),
                resolution=profile.get("resolution"),
                video_codec=profile.get("videoFormat"),
                video_bitrate=profile.get("videoBitrate"),
                audio_codec=profile.get("audioFormat"),
                audio_bitrate=profile.get("audioBitrate"),
            )
        )

    return sessions


async def get_ersatztv_status() -> ErsatzTVStatus:
    """Fetch status from ErsatzTV API.

    Fetches sessions, channels, and profiles in parallel, then joins
    the data to provide enriched session information.

    Returns:
        ErsatzTVStatus with connection status and enriched session info
    """
    now = datetime.now(UTC)
    base_url = settings.ersatztv_base_url

    try:
        client = ersatztv_client()
        (
            sessions_data,
            channels_data,
            profiles_data,
            sessions_error,
        ) = await _fetch_ersatztv_data(client, base_url, timeout=10.0)

        # If we got sessions data (even empty list), we're online
        if sessions_data is not None:
            sessions = _build_ersatztv_sessions(sessions_data, channels_data, profiles_data, now)

            log.info("ErsatzTV online with {} active sessions", len(sessions))
            return ErsatzTVStatus(
                name="ErsatzTV",
                online=True,
                last_checked=now,
                active_sessions=len(sessions),
                sessions=sessions,
            )

        # Sessions endpoint failed - check basic connectivity
        response = await client.get(base_url, timeout=10.0)
        if response.status_code < 500:
            log.info("ErsatzTV online (no session data available)")
            return ErsatzTVStatus(
                name="ErsatzTV",
                online=True,
                degraded=True,
                last_checked=now,
                error=sessions_error,
                active_sessions=0,
                sessions=[],
            )

        raise httpx.HTTPStatusError(
            "Could not connect", request=response.request, response=response
        )

    except httpx.HTTPStatusError as e:
        log.error("ErsatzTV HTTP error: {} {}", e.response.status_code, str(e))
        return ErsatzTVStatus(
            name="ErsatzTV",
            online=False,
            last_checked=now,
            error=f"HTTP {e.response.status_code}",
        )

    except httpx.HTTPError as e:
        log.error("Failed to fetch ErsatzTV status: {}", str(e))
        return ErsatzTVStatus(
            name="ErsatzTV",
            online=False,
            last_checked=now,
            error=_reason(e),
        )

    except (ValueError, TypeError, AttributeError):
        log.warning("Invalid ErsatzTV status response schema")
        return ErsatzTVStatus(
            name="ErsatzTV",
            online=False,
            last_checked=now,
            error="Invalid upstream status response",
        )


def _parse_dispatcharr_proxy_status(
    data: dict,
) -> tuple[int, int, list[DispatcharrStream]]:
    """Parse Dispatcharr proxy status to extract active stream stats.

    Args:
        data: Response from /proxy/ts/status endpoint

    Returns:
        Tuple of (active_streams, total_viewers, streams)
    """
    if not isinstance(data, dict):
        raise ValueError("Expected a status object")
    channels = _object_list(data.get("channels", []))
    streams: list[DispatcharrStream] = []

    for ch in channels:
        stream = DispatcharrStream(
            channel_id=ch.get("channel_id", ""),
            stream_name=ch.get("stream_name", "Unknown"),
            state=ch.get("state", "active"),
            client_count=ch.get("client_count", 0),
            uptime=ch.get("uptime", 0),
            total_bytes=ch.get("total_bytes", 0),
            avg_bitrate=ch.get("avg_bitrate", ""),
            video_codec=ch.get("video_codec"),
            resolution=ch.get("resolution"),
            source_fps=ch.get("source_fps"),
        )
        streams.append(stream)

    active_streams = len(streams)
    total_viewers = sum(s.client_count for s in streams)

    log.debug(
        "Parsed proxy status: {} active streams, {} viewers",
        active_streams,
        total_viewers,
    )
    return active_streams, total_viewers, streams


async def get_dispatcharr_status() -> DispatchrrStatus:
    """Fetch status from Dispatcharr API.

    Attempts to get active stream information from /proxy/ts/status.
    Requires an API key.

    Returns:
        DispatchrrStatus with connection status and stream info
    """
    now = datetime.now(UTC)
    base_url = settings.dispatcharr_url
    proxy_status_url = f"{base_url}/proxy/ts/status"

    try:
        client = dispatcharr_client()
        log.debug("Fetching Dispatcharr proxy status from {}", proxy_status_url)

        try:
            headers = dispatcharr_auth_headers()
        except DispatchrrUnavailableError:
            log.warning("No Dispatcharr API key configured, checking basic connectivity")
            # Fall back to checking if service is reachable
            response = await client.get(
                f"{base_url}/hdhr/lineup.json", follow_redirects=True, timeout=10.0
            )
            if response.status_code < 500:
                return DispatchrrStatus(
                    name="Dispatcharr",
                    online=True,
                    degraded=True,
                    last_checked=now,
                    active_streams=0,
                    total_viewers=0,
                    error="Auth required for stats",
                )
            raise httpx.HTTPStatusError(
                "Could not connect", request=response.request, response=response
            ) from None

        response = await client.get(
            proxy_status_url, headers=headers, follow_redirects=True, timeout=10.0
        )
        response.raise_for_status()

        # Parse proxy status data
        data = response.json()
        active_streams, total_viewers, streams = _parse_dispatcharr_proxy_status(data)

        log.info(
            "Dispatcharr online with {} active streams, {} viewers",
            active_streams,
            total_viewers,
        )
        return DispatchrrStatus(
            name="Dispatcharr",
            online=True,
            last_checked=now,
            active_streams=active_streams,
            total_viewers=total_viewers,
            streams=streams,
        )

    except httpx.HTTPStatusError as e:
        # If proxy status endpoint fails, try basic connectivity
        if e.response.status_code in (401, 403, 404):
            log.debug(
                "Proxy status returned {}, checking basic connectivity",
                e.response.status_code,
            )
            try:
                # Try the lineup endpoint (doesn't require auth)
                lineup_url = f"{base_url}/hdhr/lineup.json"
                response = await dispatcharr_client().get(lineup_url, timeout=10.0)
                if response.status_code < 500:
                    # 404 can also mean DISPATCHARR_URL points at the wrong host
                    reason = (
                        f"stats endpoint missing (HTTP {e.response.status_code})"
                        if e.response.status_code == 404
                        else f"API key rejected (HTTP {e.response.status_code})"
                    )
                    log.warning("Dispatcharr reachable but stats failed: {}", reason)
                    return DispatchrrStatus(
                        name="Dispatcharr",
                        online=True,
                        degraded=True,
                        last_checked=now,
                        error=reason,
                        active_streams=0,
                        total_viewers=0,
                    )
            except httpx.HTTPError:
                pass  # Fall through to offline status

        log.error("Dispatcharr HTTP error: {} {}", e.response.status_code, str(e))
        return DispatchrrStatus(
            name="Dispatcharr",
            online=False,
            last_checked=now,
            error=f"HTTP {e.response.status_code}",
        )

    except httpx.HTTPError as e:
        log.error("Failed to fetch Dispatcharr status: {}", str(e))
        return DispatchrrStatus(
            name="Dispatcharr",
            online=False,
            last_checked=now,
            error=_reason(e),
        )

    except (ValueError, TypeError, AttributeError):
        log.warning("Invalid Dispatcharr status response schema")
        return DispatchrrStatus(
            name="Dispatcharr",
            online=False,
            last_checked=now,
            error="Invalid upstream status response",
        )


async def get_epg_status() -> EPGHealthStatus:
    """Get guide data (XMLTV) health.

    Returns at once from local state. A refresh that is due starts in the
    background (at most one, and only when the failure backoff allows it), so
    status polls neither wait on nor hammer Dispatcharr.

    Returns:
        EPGHealthStatus for the cached guide data
    """
    return await get_epg_service().check_health()


async def _bounded[T](check: Coroutine[Any, Any, T]) -> T:
    """Run one status check under STATUS_CHECK_DEADLINE_SECONDS.

    A dead tunnel or black-holed upstream then costs the admin panel 5 s, not
    the checker's own 10-20 s. The checkers hold no shared work that
    cancelling could abort: the EPG check only reads state and schedules.
    """
    async with asyncio.timeout(STATUS_CHECK_DEADLINE_SECONDS):
        return await check


def _failure(result: object) -> str:
    """The error text for a status check that raised instead of returning."""
    if isinstance(result, TimeoutError):
        return "status check timed out"
    return "Status check failed"


async def get_system_status() -> SystemStatusResponse:
    """Get combined status of all external services.

    Returns:
        SystemStatusResponse with status for ErsatzTV, Dispatcharr and both guides
    """
    log.debug("Fetching system status for all services")

    # Fetch all statuses concurrently
    ersatztv_status, dispatcharr_status, epg_status = await asyncio.gather(
        _bounded(get_ersatztv_status()),
        _bounded(get_dispatcharr_status()),
        _bounded(get_epg_status()),
        return_exceptions=True,
    )

    # A failure in one integration must never hide the independent service.
    now = datetime.now(UTC)
    return SystemStatusResponse(
        ersatztv=ersatztv_status
        if isinstance(ersatztv_status, ErsatzTVStatus)
        else ErsatzTVStatus(
            name="ErsatzTV", online=False, last_checked=now, error=_failure(ersatztv_status)
        ),
        dispatcharr=dispatcharr_status
        if isinstance(dispatcharr_status, DispatchrrStatus)
        else DispatchrrStatus(
            name="Dispatcharr", online=False, last_checked=now, error=_failure(dispatcharr_status)
        ),
        epg=epg_status
        if isinstance(epg_status, EPGHealthStatus)
        else EPGHealthStatus(
            name=EPG_HEALTH_NAME, online=False, last_checked=now, error=_failure(epg_status)
        ),
        # Local state only, like the Dispatcharr guide: never contacts ErsatzTV.
        ersatztv_guide=get_guide_health(),
    )
