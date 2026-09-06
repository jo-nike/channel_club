"""Status service for monitoring external service health."""

import asyncio
from datetime import UTC, datetime

import httpx
from loguru import logger

from app.config import settings
from app.models.status import (
    DispatcharrClient,
    DispatcharrStream,
    DispatchrrStatus,
    ErsatzTVSession,
    ErsatzTVStatus,
    SystemStatusResponse,
)
from app.services.dispatcharr import (
    DispatchrrUnavailableError,
    dispatcharr_auth_headers,
)

# Module-level logger with service context
log = logger.bind(service="status")


def _object_list(value: object) -> list[dict]:
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ValueError("Expected a list of objects")
    return value


async def _fetch_ersatztv_data(
    client: httpx.AsyncClient, base_url: str
) -> tuple[list[dict] | None, list[dict], list[dict]]:
    """Fetch sessions, channels, and profiles from ErsatzTV in parallel.

    Args:
        client: httpx client
        base_url: ErsatzTV base URL

    Returns:
        Tuple of (sessions, channels, profiles). Sessions is None if fetch failed.
    """
    sessions_url = f"{base_url}/api/sessions"
    channels_url = f"{base_url}/api/channels"
    profiles_url = f"{base_url}/api/ffmpeg/profiles"

    log.debug("Fetching ErsatzTV data from {}", base_url)

    # Fetch all three endpoints in parallel
    sessions_resp, channels_resp, profiles_resp = await asyncio.gather(
        client.get(sessions_url),
        client.get(channels_url),
        client.get(profiles_url),
        return_exceptions=True,
    )

    # Parse responses - sessions is None if failed, others default to empty
    sessions: list[dict] | None = None
    channels: list[dict] = []
    profiles: list[dict] = []

    if isinstance(sessions_resp, httpx.Response) and sessions_resp.status_code == 200:
        sessions = _object_list(sessions_resp.json())
    elif isinstance(sessions_resp, Exception):
        log.warning("Failed to fetch ErsatzTV sessions: {}", sessions_resp)

    if isinstance(channels_resp, httpx.Response) and channels_resp.status_code == 200:
        channels = _object_list(channels_resp.json())
    elif isinstance(channels_resp, Exception):
        log.warning("Failed to fetch ErsatzTV channels: {}", channels_resp)

    if isinstance(profiles_resp, httpx.Response) and profiles_resp.status_code == 200:
        profiles = _object_list(profiles_resp.json())
    elif isinstance(profiles_resp, Exception):
        log.warning("Failed to fetch ErsatzTV profiles: {}", profiles_resp)

    return sessions, channels, profiles


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
        async with httpx.AsyncClient(timeout=10.0) as client:
            sessions_data, channels_data, profiles_data = await _fetch_ersatztv_data(
                client, base_url
            )

            # If we got sessions data (even empty list), we're online
            if sessions_data is not None:
                sessions = _build_ersatztv_sessions(
                    sessions_data, channels_data, profiles_data, now
                )

                log.info("ErsatzTV online with {} active sessions", len(sessions))
                return ErsatzTVStatus(
                    name="ErsatzTV",
                    online=True,
                    last_checked=now,
                    active_sessions=len(sessions),
                    sessions=sessions,
                )

            # Sessions endpoint failed - check basic connectivity
            response = await client.get(base_url)
            if response.status_code < 500:
                log.info("ErsatzTV online (no session data available)")
                return ErsatzTVStatus(
                    name="ErsatzTV",
                    online=True,
                    last_checked=now,
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
            error=str(e),
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
        # Parse clients
        clients = [
            DispatcharrClient(
                client_id=c.get("client_id", ""),
                user_agent=c.get("user_agent"),
                ip_address=c.get("ip_address"),
                connected_since=c.get("connected_since", 0),
            )
            for c in _object_list(ch.get("clients", []))
        ]

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
            clients=clients,
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
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            log.debug("Fetching Dispatcharr proxy status from {}", proxy_status_url)

            try:
                headers = dispatcharr_auth_headers()
            except DispatchrrUnavailableError:
                log.warning("No Dispatcharr API key configured, checking basic connectivity")
                # Fall back to checking if service is reachable
                response = await client.get(f"{base_url}/hdhr/lineup.json")
                if response.status_code < 500:
                    return DispatchrrStatus(
                        name="Dispatcharr",
                        online=True,
                        last_checked=now,
                        active_streams=0,
                        total_viewers=0,
                        error="Auth required for stats",
                    )
                raise httpx.HTTPStatusError(
                    "Could not connect", request=response.request, response=response
                ) from None

            response = await client.get(proxy_status_url, headers=headers)
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
                async with httpx.AsyncClient(timeout=10.0) as client:
                    # Try the lineup endpoint (doesn't require auth)
                    lineup_url = f"{base_url}/hdhr/lineup.json"
                    response = await client.get(lineup_url)
                    if response.status_code < 500:
                        log.info(
                            "Dispatcharr online (stats require auth - configure "
                            "DISPATCHARR_API_KEY)"
                        )
                        return DispatchrrStatus(
                            name="Dispatcharr",
                            online=True,
                            last_checked=now,
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
            error=str(e),
        )

    except (ValueError, TypeError, AttributeError):
        log.warning("Invalid Dispatcharr status response schema")
        return DispatchrrStatus(
            name="Dispatcharr",
            online=False,
            last_checked=now,
            error="Invalid upstream status response",
        )


async def get_system_status() -> SystemStatusResponse:
    """Get combined status of all external services.

    Returns:
        SystemStatusResponse with status for ErsatzTV and Dispatcharr
    """
    log.debug("Fetching system status for all services")

    # Fetch both statuses concurrently
    ersatztv_status, dispatcharr_status = await asyncio.gather(
        get_ersatztv_status(),
        get_dispatcharr_status(),
        return_exceptions=True,
    )

    # A failure in one integration must never hide the independent service.
    now = datetime.now(UTC)
    return SystemStatusResponse(
        ersatztv=ersatztv_status
        if isinstance(ersatztv_status, ErsatzTVStatus)
        else ErsatzTVStatus(
            name="ErsatzTV", online=False, last_checked=now, error="Status check failed"
        ),
        dispatcharr=dispatcharr_status
        if isinstance(dispatcharr_status, DispatchrrStatus)
        else DispatchrrStatus(
            name="Dispatcharr", online=False, last_checked=now, error="Status check failed"
        ),
    )
