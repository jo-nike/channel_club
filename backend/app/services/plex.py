"""Plex authentication service for validating Plex tokens and server access."""

import asyncio

import httpx
from loguru import logger

from app.config import settings
from app.models.plex import PlexUser

# Module-level logger with service context
log = logger.bind(service="plex")

PLEX_API_HEADERS = {
    "Accept": "application/json",
    "X-Plex-Product": "Channel Club",
    "X-Plex-Client-Identifier": "iptv-viewer-2",
}


class PlexAuthError(Exception):
    """Base exception for Plex authentication errors."""

    pass


class InvalidPlexTokenError(PlexAuthError):
    """Raised when Plex token is invalid or expired."""

    pass


class PlexServerAccessDeniedError(PlexAuthError):
    """Raised when user does not have access to configured Plex server."""

    pass


async def validate_plex_token(auth_token: str) -> PlexUser:
    """Validate Plex auth token and return user info.

    Args:
        auth_token: The Plex authentication token to validate.

    Returns:
        PlexUser with user information from Plex API.

    Raises:
        InvalidPlexTokenError: If token is invalid or expired.
    """
    # Log only first 8 characters of token for debugging (never full token!)
    log.debug("Validating Plex token: {}...", auth_token[:8] if auth_token else "empty")

    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://plex.tv/api/v2/user",
            headers={**PLEX_API_HEADERS, "X-Plex-Token": auth_token},
        )
        if response.status_code != 200:
            log.warning("Plex token validation failed with status {}", response.status_code)
            raise InvalidPlexTokenError("Invalid or expired Plex token")

        try:
            data = response.json()
        except Exception as e:
            log.error("Invalid response from Plex API: {}", e)
            raise InvalidPlexTokenError(f"Invalid response from Plex API: {e}") from e

        try:
            user = PlexUser(
                id=str(data["id"]),
                username=data["username"],
                email=data.get("email", ""),
                thumb=data.get("thumb"),
            )
            log.info("Plex user validated: {}", user.username)
            return user
        except KeyError as e:
            log.error("Missing field in Plex response: {}", e)
            raise InvalidPlexTokenError(f"Missing field in Plex response: {e}") from e


_server_owner_id_cache: dict[str, str] = {}
# The one plex.tv owner lookup in flight, shared by every caller that misses the
# cache so a burst of admin requests after a deploy makes a single upstream call.
_owner_id_lookup: asyncio.Task[str | None] | None = None
OWNER_LOOKUP_TIMEOUT_SECONDS = 3.0


async def _fetch_server_owner_id(server_token: str) -> str | None:
    """Ask plex.tv for the owner id and cache it; None (uncached) on any failure."""
    log.debug("Fetching server owner ID from Plex API")
    try:
        async with httpx.AsyncClient(timeout=OWNER_LOOKUP_TIMEOUT_SECONDS) as client:
            response = await client.get(
                "https://plex.tv/api/v2/user",
                headers={**PLEX_API_HEADERS, "X-Plex-Token": server_token},
            )
    except httpx.HTTPError as e:
        # Not cached: an unreachable plex.tv must not permanently downgrade the owner.
        log.warning("Failed to fetch server owner ID: {}", type(e).__name__)
        return None
    if response.status_code != 200:
        # Not cached: a transient 5xx/429 must not permanently downgrade the
        # owner. The next login retries the lookup.
        log.warning("Failed to fetch server owner ID, status: {}", response.status_code)
        return None

    try:
        owner_id = response.json().get("id")
    except Exception as e:
        # Not cached, for the same reason as the non-200 branch above.
        log.error("Error parsing server owner response: {}", e)
        return None
    if owner_id is None or owner_id == "":
        # Not cached: str(None) would pin the owner id to the string "None".
        log.error("Server owner response has no id")
        return None
    _server_owner_id_cache["owner_id"] = str(owner_id)
    log.debug("Cached server owner ID")
    return str(owner_id)


def _forget_owner_id_lookup(task: asyncio.Task[str | None]) -> None:
    global _owner_id_lookup
    if _owner_id_lookup is task:
        _owner_id_lookup = None


def _start_owner_id_lookup(server_token: str) -> asyncio.Task[str | None]:
    global _owner_id_lookup
    if _owner_id_lookup is None:
        _owner_id_lookup = asyncio.create_task(_fetch_server_owner_id(server_token))
        _owner_id_lookup.add_done_callback(_forget_owner_id_lookup)
    return _owner_id_lookup


async def get_server_owner_id() -> str | None:
    """Get the Plex ID of the server owner from PLEX_SERVER_TOKEN.

    Returns:
        The Plex user ID of the server owner, or None if not configured/invalid.

    Note:
        Only successful lookups are cached, to avoid repeated API calls. A
        failed lookup is never cached: caching None would strip the owner's
        admin role for the lifetime of the process after one transient error.
        Concurrent cache misses share one plex.tv call.
    """
    if not settings.plex_server_token:
        log.debug("No Plex server token configured")
        return None

    # Check cache
    cache_key = "owner_id"
    if cache_key in _server_owner_id_cache:
        log.debug("Using cached server owner ID")
        return _server_owner_id_cache[cache_key]

    # Shielded so a caller that is cancelled (a dropped request) does not cancel
    # the lookup the other callers are waiting on.
    return await asyncio.shield(_start_owner_id_lookup(settings.plex_server_token))


def start_server_owner_lookup() -> None:
    """Warm the owner id cache in the background at boot, without waiting.

    The cache is empty after every deploy, and require_admin needs the owner id
    to tell the owner apart from a demoted admin. Never blocks or raises.
    """
    if settings.plex_auth_enabled and settings.plex_server_token:
        _start_owner_id_lookup(settings.plex_server_token)


def clear_server_owner_id_cache() -> None:
    """Clear the cached server owner id and forget any lookup in flight."""
    global _owner_id_lookup
    _server_owner_id_cache.clear()
    _owner_id_lookup = None


async def determine_role(plex_user: PlexUser) -> str:
    """Determine the role for a Plex user.

    Priority order:
    1. Server owner always gets "admin"
    2. Users in plex_admin_users list get "admin"
    3. Otherwise, use plex_default_role

    Args:
        plex_user: The authenticated Plex user.

    Returns:
        "admin" if user is server owner or in admin list, otherwise plex_default_role.
    """
    # Check if user is the server owner
    owner_id = await get_server_owner_id()
    if owner_id and plex_user.id == owner_id:
        return "admin"

    # Check if user is in admin list
    if settings.plex_admin_users and plex_user.username in settings.plex_admin_users:
        return "admin"

    # Return default role
    return settings.plex_default_role


async def check_server_access(auth_token: str) -> bool:
    """Check if user has access to configured Plex server.

    Args:
        auth_token: The Plex authentication token.

    Returns:
        True if user has access to configured server, False otherwise.
        If no server is configured (plex_server_machine_id is None),
        returns True to allow all Plex users.
    """
    if not settings.plex_server_machine_id:
        log.debug("No Plex server machine ID configured, allowing access")
        return True  # No server configured, allow all Plex users

    log.debug("Checking user access to Plex server")
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://plex.tv/api/v2/resources",
            headers={**PLEX_API_HEADERS, "X-Plex-Token": auth_token},
            params={"includeHttps": 1},
        )
        if response.status_code != 200:
            log.warning("Failed to check server access, status: {}", response.status_code)
            return False

        resources = response.json()
        for resource in resources:
            if resource.get("clientIdentifier") == settings.plex_server_machine_id:
                log.debug("User has access to configured Plex server")
                return True

        log.warning("User does not have access to configured Plex server")
        return False
