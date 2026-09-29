"""Plex authentication service for validating Plex tokens and server access."""

import asyncio
import json
import re
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from xml.etree.ElementTree import ParseError

import httpx
from defusedxml import DefusedXmlException, ElementTree
from loguru import logger
from pydantic import ValidationError

from app.config import settings
from app.models.plex import PlexMember, PlexServer, PlexUser
from app.models.setup import MACHINE_ID_PATTERN
from app.services.bounded_http import read_bounded
from app.services.tls import SSL_CONTEXT

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


class PlexUnavailableError(PlexAuthError):
    """Raised when plex.tv times out, errors, rate limits or answers garbage."""

    pass


# plex.tv sign-in calls: fail fast rather than hold a sign-in open.
PLEX_TIMEOUT = httpx.Timeout(5.0, connect=3.0)
# The server and member lists are read with a bound, so a misbehaving answer
# can't grow memory. /api/users is a few hundred bytes of XML per person.
PLEX_LIST_BYTES = 4 * 1024 * 1024


async def validate_plex_token(auth_token: str) -> PlexUser:
    """Validate Plex auth token and return user info.

    Args:
        auth_token: The Plex authentication token to validate.

    Returns:
        PlexUser with user information from Plex API.

    Raises:
        InvalidPlexTokenError: If plex.tv answers 401 (token invalid or expired).
        PlexUnavailableError: If plex.tv is unreachable, slow, answers any other
            non-200, or returns a body that is not a user.
    """
    # Log only first 8 characters of token for debugging (never full token!)
    log.debug("Validating Plex token: {}...", auth_token[:8] if auth_token else "empty")

    try:
        async with httpx.AsyncClient(timeout=PLEX_TIMEOUT, verify=SSL_CONTEXT) as client:
            response = await client.get(
                "https://plex.tv/api/v2/user",
                headers={**PLEX_API_HEADERS, "X-Plex-Token": auth_token},
            )
    except httpx.HTTPError as e:
        log.warning("Plex token validation failed: {}", type(e).__name__)
        raise PlexUnavailableError("plex.tv is unreachable") from e
    if response.status_code == 401:
        log.warning("Plex token validation failed with status 401")
        raise InvalidPlexTokenError("Invalid or expired Plex token")
    if response.status_code != 200:
        # A 5xx, 429 or any other status is plex.tv's trouble, not a bad token.
        log.warning("Plex token validation failed with status {}", response.status_code)
        raise PlexUnavailableError(f"plex.tv answered {response.status_code}")

    try:
        data = response.json()
    except ValueError as e:
        log.error("Invalid response from Plex API: {}", e)
        raise PlexUnavailableError(f"Invalid response from Plex API: {e}") from e

    try:
        user_id = data["id"]
        # A non-empty string or number; "" or an object is as unusable as no id
        if isinstance(user_id, bool) or not isinstance(user_id, str | int) or user_id == "":
            raise KeyError("id")
        user = PlexUser(
            id=str(data["id"]),
            username=data["username"],
            email=data.get("email", ""),
            thumb=data.get("thumb"),
        )
    except (KeyError, TypeError, AttributeError, ValidationError) as e:
        log.error("Unexpected Plex user response: {}", type(e).__name__)
        raise PlexUnavailableError("Unexpected Plex user response") from e
    log.info("Plex user validated: {}", user.username)
    return user


_server_owner_id_cache: dict[str, str] = {}
# The one plex.tv owner lookup in flight, shared by every caller that misses the
# cache so a burst of admin requests after a deploy makes a single upstream call.
_owner_id_lookup: asyncio.Task[str | None] | None = None
# Bumped by every clear: a lookup started before it (under the old token or
# switch) must not put the old owner back in the cache.
_owner_generation = 0
OWNER_LOOKUP_TIMEOUT_SECONDS = 3.0


async def _fetch_server_owner_id(server_token: str, generation: int) -> str | None:
    """Ask plex.tv for the owner id and cache it; None (uncached) on any failure.

    A lookup that a clear overtook returns None and caches nothing.
    """
    log.debug("Fetching server owner ID from Plex API")
    try:
        async with httpx.AsyncClient(
            timeout=OWNER_LOOKUP_TIMEOUT_SECONDS, verify=SSL_CONTEXT
        ) as client:
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
    if generation != _owner_generation:
        log.debug("Owner lookup discarded: the Plex settings changed while it ran")
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
        # The generation is taken now, not when the task first runs
        lookup = _fetch_server_owner_id(server_token, _owner_generation)
        _owner_id_lookup = asyncio.create_task(lookup)
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
    server_token = settings.plex_server_token
    if not (server_token and server_token.get_secret_value()):
        log.debug("No Plex server token configured")
        return None

    # Check cache
    cache_key = "owner_id"
    if cache_key in _server_owner_id_cache:
        log.debug("Using cached server owner ID")
        return _server_owner_id_cache[cache_key]

    # Shielded so a caller that is cancelled (a dropped request) does not cancel
    # the lookup the other callers are waiting on.
    return await asyncio.shield(_start_owner_id_lookup(server_token.get_secret_value()))


def start_server_owner_lookup() -> None:
    """Warm the owner id cache in the background at boot, without waiting.

    The cache is empty after every deploy, and require_admin needs the owner id
    to tell the owner apart from a demoted admin. Never blocks or raises.
    """
    server_token = settings.plex_server_token
    if settings.plex_auth_enabled and server_token and server_token.get_secret_value():
        _start_owner_id_lookup(server_token.get_secret_value())


async def stop_server_owner_lookup() -> None:
    """Cancel the owner lookup if it is still running, so shutdown leaves no pending task."""
    task = _owner_id_lookup
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


def clear_server_owner_id_cache() -> None:
    """Clear the cached server owner id, and make any lookup in flight cache nothing."""
    global _owner_id_lookup, _owner_generation
    _server_owner_id_cache.clear()
    _owner_id_lookup = None
    _owner_generation += 1


async def determine_role(plex_user: PlexUser) -> str:
    """Determine the role for a Plex user.

    Priority order:
    1. Plex account ids in plex_admin_ids get "admin" (no plex.tv call)
    2. Server owner always gets "admin"
    3. Users in plex_admin_users list get "admin"
    4. Otherwise, use plex_default_role

    Args:
        plex_user: The authenticated Plex user.

    Returns:
        "admin" if user is server owner or in admin list, otherwise plex_default_role.
    """
    # Admins picked in the UI are known by account id, which survives a rename
    if plex_user.id in settings.plex_admin_ids:
        return "admin"

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

    Raises:
        PlexUnavailableError: If plex.tv is unreachable, slow, answers non-200,
            or returns a body that is not a list of resources.
    """
    if not settings.plex_server_machine_id:
        log.debug("No Plex server machine ID configured, allowing access")
        return True  # No server configured, allow all Plex users

    log.debug("Checking user access to Plex server")
    try:
        async with httpx.AsyncClient(timeout=PLEX_TIMEOUT, verify=SSL_CONTEXT) as client:
            response = await client.get(
                "https://plex.tv/api/v2/resources",
                headers={**PLEX_API_HEADERS, "X-Plex-Token": auth_token},
                params={"includeHttps": 1},
            )
    except httpx.HTTPError as e:
        log.warning("Failed to check server access: {}", type(e).__name__)
        raise PlexUnavailableError("plex.tv is unreachable") from e
    if response.status_code != 200:
        # The token was just accepted by /user, so a failure here is plex.tv's.
        log.warning("Failed to check server access, status: {}", response.status_code)
        raise PlexUnavailableError(f"plex.tv answered {response.status_code}")

    try:
        resources = response.json()
    except ValueError as e:
        log.error("Invalid resources response from Plex API: {}", e)
        raise PlexUnavailableError(f"Invalid response from Plex API: {e}") from e
    if not isinstance(resources, list) or not all(isinstance(r, dict) for r in resources):
        log.error("Unexpected Plex resources response: {}", type(resources).__name__)
        raise PlexUnavailableError("Unexpected Plex resources response")

    for resource in resources:
        if resource.get("clientIdentifier") == settings.plex_server_machine_id:
            log.debug("User has access to configured Plex server")
            return True

    log.warning("User does not have access to configured Plex server")
    return False


def _timestamp(value: object) -> datetime | None:
    """plex.tv's ISO 8601 or epoch-seconds time, or None when it is neither."""
    try:
        if isinstance(value, str):
            return datetime.fromisoformat(value)
        if isinstance(value, int) and not isinstance(value, bool):
            return datetime.fromtimestamp(value, UTC)
    except (ValueError, OverflowError, OSError):
        pass
    return None


async def _get_list(url: str, auth_token: str, accept: str, **params: str | int) -> bytes:
    """GET one of plex.tv's lists, with a bounded body.

    Raises:
        InvalidPlexTokenError: plex.tv answered 401.
        PlexUnavailableError: plex.tv is unreachable, slow or answers another
            non-200, or the body is over PLEX_LIST_BYTES.
    """
    headers = {**PLEX_API_HEADERS, "Accept": accept, "X-Plex-Token": auth_token}
    try:
        async with (
            httpx.AsyncClient(timeout=PLEX_TIMEOUT, verify=SSL_CONTEXT) as client,
            client.stream("GET", url, headers=headers, params=params) as response,
        ):
            if response.status_code == 401:
                raise InvalidPlexTokenError("Invalid or expired Plex token")
            if response.status_code != 200:
                log.warning("plex.tv list request failed with status {}", response.status_code)
                raise PlexUnavailableError(f"plex.tv answered {response.status_code}")
            return await read_bounded(response, PLEX_LIST_BYTES)
    except httpx.HTTPError as e:
        log.warning("plex.tv list request failed: {}", type(e).__name__)
        raise PlexUnavailableError("plex.tv is unreachable") from e
    except (ValueError, TimeoutError) as e:
        # read_bounded: over the byte budget, or the body took too long
        log.warning("plex.tv list answer was too large or too slow")
        raise PlexUnavailableError("plex.tv answered too much or too slowly") from e


@dataclass(frozen=True)
class SharedUser:
    """One person in the owner's /api/users list."""

    plex_id: str
    username: str
    managed: bool
    # A member of the owner's Plex Home, who reaches every server of theirs
    home: bool
    # Servers shared with this person whose invitation they accepted
    machine_ids: frozenset[str]


async def list_shared_users(auth_token: str) -> list[SharedUser]:
    """Everyone the account shares a server with, from plex.tv's /api/users.

    That endpoint is undocumented (Overseerr and Tautulli read it too), so it
    is parsed defensively: a person without an id or a name is skipped, and
    emails and avatars are never read.

    Raises:
        InvalidPlexTokenError: plex.tv answered 401.
        PlexUnavailableError: plex.tv failed, or the answer is not the expected XML.
    """
    body = await _get_list("https://plex.tv/api/users", auth_token, "application/xml")
    try:
        root = ElementTree.fromstring(body)
    except (ParseError, DefusedXmlException) as e:
        log.warning("Unexpected Plex users response: {}", type(e).__name__)
        raise PlexUnavailableError("Invalid users response from Plex API") from e
    if root.tag != "MediaContainer":
        raise PlexUnavailableError("Unexpected Plex users response")
    users: list[SharedUser] = []
    for element in root.findall("User"):
        plex_id = element.get("id", "")
        # Managed users have a title but no username
        username = element.get("username") or element.get("title") or ""
        if not plex_id or not username:
            continue
        machine_ids = frozenset(
            server.get("machineIdentifier", "")
            for server in element.findall("Server")
            if server.get("pending") != "1"
        ) - {""}
        users.append(
            SharedUser(
                plex_id=plex_id,
                username=username,
                managed=element.get("restricted") == "1",
                home=element.get("home") == "1",
                machine_ids=machine_ids,
            )
        )
    return users


def _reaches(user: SharedUser, machine_id: str) -> bool:
    return user.home or machine_id in user.machine_ids


async def list_owned_servers(auth_token: str, count_members: bool = True) -> list[PlexServer]:
    """The Plex Media Servers this account owns, for the setup wizard's picker.

    With count_members, each carries the number of people it is shared with,
    or None when the user list couldn't be read (the picker works without it).

    Raises:
        InvalidPlexTokenError: plex.tv answered 401.
        PlexUnavailableError: plex.tv failed, or the resource list is not a list.
    """
    body = await _get_list(
        "https://plex.tv/api/v2/resources", auth_token, "application/json", includeHttps=1
    )
    try:
        resources = json.loads(body)
    except ValueError as e:
        log.warning("Invalid resources response from Plex API")
        raise PlexUnavailableError("Invalid resources response from Plex API") from e
    if not isinstance(resources, list) or not all(isinstance(r, dict) for r in resources):
        raise PlexUnavailableError("Unexpected Plex resources response")

    servers: list[PlexServer] = []
    for resource in resources:
        provides = resource.get("provides")
        machine_id = resource.get("clientIdentifier")
        name = resource.get("name")
        if (
            resource.get("owned") is not True
            or not isinstance(provides, str)
            or "server" not in provides.split(",")
            or not isinstance(machine_id, str)
            or not re.fullmatch(MACHINE_ID_PATTERN, machine_id)
            or not isinstance(name, str)
        ):
            continue
        servers.append(
            PlexServer(
                machine_id=machine_id,
                name=name,
                online=resource.get("presence") is True,
                last_seen_at=_timestamp(resource.get("lastSeenAt")),
            )
        )
    if not servers or not count_members:
        return servers

    try:
        users = await list_shared_users(auth_token)
    except PlexAuthError:
        return servers
    return [
        server.model_copy(
            update={"member_count": sum(_reaches(user, server.machine_id) for user in users)}
        )
        for server in servers
    ]


async def list_server_members(auth_token: str, machine_id: str) -> list[PlexMember]:
    """The owner (the token's account) first, then everyone the server is shared with.

    Pending invitations are left out; Plex Home members are in, since they reach
    every server the owner has.

    Raises:
        InvalidPlexTokenError: plex.tv answered 401.
        PlexUnavailableError: plex.tv failed or answered garbage.
    """
    owner = await validate_plex_token(auth_token)
    users = await list_shared_users(auth_token)
    return [PlexMember(plex_id=owner.id, username=owner.username, owner=True)] + [
        PlexMember(plex_id=user.plex_id, username=user.username, managed=user.managed)
        for user in users
        if _reaches(user, machine_id) and user.plex_id != owner.id
    ]
