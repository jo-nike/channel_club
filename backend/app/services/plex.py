"""Plex authentication service for validating Plex tokens and server access."""

import httpx

from app.config import settings
from app.models.plex import PlexUser

PLEX_API_HEADERS = {
    "Accept": "application/json",
    "X-Plex-Product": "IPTV Viewer",
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
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://plex.tv/api/v2/user",
            headers={**PLEX_API_HEADERS, "X-Plex-Token": auth_token},
        )
        if response.status_code != 200:
            raise InvalidPlexTokenError("Invalid or expired Plex token")

        try:
            data = response.json()
        except Exception as e:
            raise InvalidPlexTokenError(f"Invalid response from Plex API: {e}") from e

        try:
            return PlexUser(
                id=str(data["id"]),
                username=data["username"],
                email=data.get("email", ""),
                thumb=data.get("thumb"),
            )
        except KeyError as e:
            raise InvalidPlexTokenError(f"Missing field in Plex response: {e}") from e


_server_owner_id_cache: dict[str, str | None] = {}


async def get_server_owner_id() -> str | None:
    """Get the Plex ID of the server owner from PLEX_SERVER_TOKEN.

    Returns:
        The Plex user ID of the server owner, or None if not configured/invalid.

    Note:
        Result is cached to avoid repeated API calls.
    """
    if not settings.plex_server_token:
        return None

    # Check cache
    cache_key = "owner_id"
    if cache_key in _server_owner_id_cache:
        return _server_owner_id_cache[cache_key]

    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://plex.tv/api/v2/user",
            headers={**PLEX_API_HEADERS, "X-Plex-Token": settings.plex_server_token},
        )
        if response.status_code != 200:
            _server_owner_id_cache[cache_key] = None
            return None

        try:
            data = response.json()
            owner_id = str(data.get("id"))
            _server_owner_id_cache[cache_key] = owner_id
            return owner_id
        except Exception:
            _server_owner_id_cache[cache_key] = None
            return None


# Allow tests to clear the cache
get_server_owner_id.cache_clear = lambda: _server_owner_id_cache.clear()  # type: ignore[attr-defined]


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
        return True  # No server configured, allow all Plex users

    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://plex.tv/api/v2/resources",
            headers={**PLEX_API_HEADERS, "X-Plex-Token": auth_token},
            params={"includeHttps": 1},
        )
        if response.status_code != 200:
            return False

        resources = response.json()
        for resource in resources:
            if resource.get("clientIdentifier") == settings.plex_server_machine_id:
                return True
        return False
