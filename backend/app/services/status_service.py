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

# Module-level logger with service context
log = logger.bind(service="status")


async def get_ersatztv_status() -> ErsatzTVStatus:
    """Fetch status from ErsatzTV API.

    Attempts to get active session information from /api/sessions.
    Falls back to simple connectivity check if endpoint unavailable.

    Returns:
        ErsatzTVStatus with connection status and session info
    """
    now = datetime.now(UTC)
    base_url = settings.ersatztv_base_url

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Try the sessions endpoint first (v0.8.5+)
            sessions_url = f"{base_url}/api/sessions"
            log.debug("Fetching ErsatzTV sessions from {}", sessions_url)

            response = await client.get(sessions_url)
            response.raise_for_status()

            # Parse session data
            sessions_data = response.json()
            sessions = []
            if isinstance(sessions_data, list):
                for session in sessions_data:
                    sessions.append(
                        ErsatzTVSession(
                            channel_number=session.get("channelNumber", 0),
                            channel_name=session.get("channelName"),
                        )
                    )

            log.info(
                "ErsatzTV online with {} active sessions", len(sessions)
            )
            return ErsatzTVStatus(
                name="ErsatzTV",
                online=True,
                last_checked=now,
                active_sessions=len(sessions),
                sessions=sessions,
            )

    except httpx.HTTPStatusError as e:
        # If sessions endpoint not found, try basic connectivity
        if e.response.status_code == 404:
            log.debug("Sessions endpoint not found, checking basic connectivity")
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    # Try the base URL to check if ErsatzTV is running
                    response = await client.get(base_url)
                    if response.status_code < 500:
                        log.info("ErsatzTV online (sessions endpoint unavailable)")
                        return ErsatzTVStatus(
                            name="ErsatzTV",
                            online=True,
                            last_checked=now,
                            active_sessions=0,
                            sessions=[],
                        )
            except httpx.HTTPError:
                pass  # Fall through to offline status

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


async def _dispatcharr_get_token(client: httpx.AsyncClient, base_url: str) -> str | None:
    """Get JWT access token from Dispatcharr using SimpleJWT.

    Args:
        client: httpx client
        base_url: Dispatcharr base URL

    Returns:
        JWT access token if successful, None otherwise
    """
    if not settings.dispatcharr_username or not settings.dispatcharr_password:
        return None

    try:
        # First get CSRF token
        await client.get(f"{base_url}/api/")
        csrf_token = client.cookies.get("csrftoken")

        credentials = {
            "username": settings.dispatcharr_username,
            "password": settings.dispatcharr_password,
        }

        headers = {"Content-Type": "application/json"}
        if csrf_token:
            headers["X-CSRFToken"] = csrf_token

        # SimpleJWT token endpoint (under accounts app)
        token_url = f"{base_url}/api/accounts/token/"
        log.debug("Getting JWT token from: {}", token_url)

        response = await client.post(token_url, json=credentials, headers=headers)

        if response.status_code == 200:
            data = response.json()
            log.debug("Token response keys: {}", list(data.keys()))

            # SimpleJWT returns 'access' and 'refresh' tokens
            access_token = data.get("access")
            if access_token:
                log.info("Successfully got JWT token from Dispatcharr")
                return access_token

        log.warning(
            "Dispatcharr token request failed: {} - {}",
            response.status_code,
            response.text[:200] if response.text else "no response",
        )
        return None

    except httpx.HTTPError as e:
        log.warning("Dispatcharr token error: {}", str(e))
        return None


def _parse_dispatcharr_proxy_status(
    data: dict,
) -> tuple[int, int, list[DispatcharrStream]]:
    """Parse Dispatcharr proxy status to extract active stream stats.

    Args:
        data: Response from /proxy/ts/status endpoint

    Returns:
        Tuple of (active_streams, total_viewers, streams)
    """
    channels = data.get("channels", [])
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
            for c in ch.get("clients", [])
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
    Requires JWT auth.

    Returns:
        DispatchrrStatus with connection status and stream info
    """
    now = datetime.now(UTC)
    base_url = settings.dispatcharr_url
    proxy_status_url = f"{base_url}/proxy/ts/status"

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            log.debug("Fetching Dispatcharr proxy status from {}", proxy_status_url)

            # Get JWT token for auth
            token = await _dispatcharr_get_token(client, base_url)
            if not token:
                log.warning("Could not get Dispatcharr token, checking basic connectivity")
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
                )

            # Fetch proxy status with Bearer token
            headers = {"Authorization": f"Bearer {token}"}
            response = await client.get(proxy_status_url, headers=headers)
            response.raise_for_status()

            # Parse proxy status data
            data = response.json()
            active_streams, total_viewers, streams = _parse_dispatcharr_proxy_status(
                data
            )

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
                            "DISPATCHARR_USERNAME and DISPATCHARR_PASSWORD)"
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
    )

    return SystemStatusResponse(
        ersatztv=ersatztv_status,
        dispatcharr=dispatcharr_status,
    )
