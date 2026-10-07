"""First-run setup: the first visitor claims the club, then the admin finishes setup.

While setup is unclaimed these endpoints are public (a token the browser still
holds is ignored), and anyone may claim: the first visitor wins, as in Jellyfin
and Overseerr. Cross-site claims are refused because a claim must be sent as
application/json, which another site can't do without a CORS preflight.
"""

import asyncio
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from loguru import logger
from pydantic.alias_generators import to_camel

from app import config
from app.config import IMAGE_FIELDS, UI_FIELDS, UiField, env_name, settings
from app.models.auth import TokenPayload, TokenResponse
from app.models.plex import PlexAuthRequest
from app.models.setup import (
    EnvLock,
    PasswordClaim,
    PlexAccount,
    PlexServersResponse,
    SetupAccountRequest,
    SetupCompleteResponse,
    SetupFeatures,
    SetupStatusResponse,
)
from app.routers.auth_deps import get_current_user, require_admin, security_optional
from app.services import config_apply, settings_store
from app.services.auth import create_access_token
from app.services.dispatcharr import get_grouped_channels
from app.services.ersatztv.epg_service import get_channels
from app.services.ersatztv.refresh import run_feed_lookup
from app.services.passwords import hash_password
from app.services.plex import (
    InvalidPlexTokenError,
    PlexUnavailableError,
    list_owned_servers,
    validate_plex_token,
)
from app.services.settings_store import SettingsDocument

router = APIRouter(tags=["setup"])
log = logger.bind(router="setup")

# While setup is open anyone can make this server call plex.tv, so those calls
# are limited for all visitors together: one at a time and this many a minute.
# A flood must not get the server's address rate-limited by plex.tv.
PLEX_CALLS_PER_MINUTE = 10
_plex_calls: deque[float] = deque()
_plex_call_running = False

# How long the On air facts wait for each source's channel list
FACTS_TIMEOUT_SECONDS = 5


def _error(status_code: int, code: str, message: str) -> HTTPException:
    """An error the wizard tells apart by code; it words the message itself."""
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def reset_setup_limits() -> None:
    """Forget the plex.tv call window (tests)."""
    global _plex_call_running
    _plex_calls.clear()
    _plex_call_running = False


@asynccontextmanager
async def _limited_plex_call() -> AsyncIterator[None]:
    """Admit one unauthenticated plex.tv call, or answer 429."""
    global _plex_call_running
    now = monotonic()
    while _plex_calls and now - _plex_calls[0] >= 60:
        _plex_calls.popleft()
    if _plex_call_running or len(_plex_calls) >= PLEX_CALLS_PER_MINUTE:
        raise _error(429, "busy", "Setup is busy talking to Plex; try again in a moment")
    _plex_calls.append(now)
    _plex_call_running = True
    try:
        yield
    finally:
        _plex_call_running = False


def _plex_errors(err: Exception) -> HTTPException:
    """400 for a token plex.tv refused (not 401, which would sign the browser out)."""
    if isinstance(err, InvalidPlexTokenError):
        return _error(400, "plex_token", "Plex didn't accept that sign-in")
    return _error(503, "plex_unavailable", "Plex is not responding, try again shortly")


def _require_unclaimed() -> None:
    if settings_store.auth_env_managed():
        raise _error(409, "env_managed", "Sign-in is set in the server's environment")
    if settings_store.setup_state() != "unclaimed":
        raise _error(409, "already_claimed", "Channel Club has already been claimed")


async def unclaimed_or_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_optional),
) -> TokenPayload | None:
    """Anyone while setup is unclaimed (ignoring any token); afterwards, admins only."""
    if settings_store.setup_state() == "unclaimed":
        return None
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return await require_admin(await get_current_user(credentials))


@router.get("/status", response_model=SetupStatusResponse)
async def get_setup_status() -> SetupStatusResponse:
    """Whether setup is open, and which variables the environment sets.

    Public. The variables are names only, and only while setup is unclaimed:
    the admin sees the rest in the Admin panel.
    """
    state = settings_store.setup_state()
    locked: list[EnvLock] = []
    if state == "unclaimed":
        locked = [
            EnvLock(env=env_name(field), field=to_camel(field) if field in UI_FIELDS else None)
            for field in sorted(config.ENV_FIELDS - IMAGE_FIELDS)
        ]
    return SetupStatusResponse(setup_state=state, env_locked=locked)


@router.post("/plex/servers", response_model=PlexServersResponse)
async def get_plex_servers(
    request: PlexAuthRequest,
    admin: TokenPayload | None = Depends(unclaimed_or_admin),
) -> PlexServersResponse:
    """The Plex servers the signed-in Plex account owns, for the picker.

    Only owned servers, and only what the picker shows. While setup is
    unclaimed the plex.tv calls are rate limited for everyone together.
    """
    try:
        if admin is None:
            async with _limited_plex_call():
                account = await validate_plex_token(request.auth_token)
                servers = await list_owned_servers(request.auth_token)
        else:
            account = await validate_plex_token(request.auth_token)
            servers = await list_owned_servers(request.auth_token)
    except (InvalidPlexTokenError, PlexUnavailableError) as err:
        raise _plex_errors(err) from err
    return PlexServersResponse(account=PlexAccount(username=account.username), servers=servers)


@router.post("/account", response_model=TokenResponse)
async def claim(request: SetupAccountRequest) -> TokenResponse:
    """Create the first admin account and sign them in: the first visitor wins.

    Everything slow (plex.tv, the password hash) runs before the store's lock;
    under it the state is checked again, the file written and the values
    applied, so of two racing claims exactly one succeeds.

    Raises:
        HTTPException: 409 once claimed or when sign-in is set in the
            environment; 400/503 for plex.tv; 403 for a server the Plex
            account doesn't own; 500 when the settings can't be saved.
    """
    _require_unclaimed()
    if isinstance(request, PasswordClaim):
        values: dict[UiField, object] = {
            "local_auth_enabled": True,
            "admin_username": request.username,
            "admin_password_hash": await hash_password(request.password),
        }
        claims: dict[str, object] = {"sub": request.username, "role": "admin"}
        server_name = None
    else:
        try:
            async with _limited_plex_call():
                account = await validate_plex_token(request.auth_token)
                servers = await list_owned_servers(request.auth_token, count_members=False)
        except (InvalidPlexTokenError, PlexUnavailableError) as err:
            raise _plex_errors(err) from err
        server = next((s for s in servers if s.machine_id == request.machine_id), None)
        if server is None:
            log.warning("Setup claim refused: {} doesn't own that server", account.username)
            raise _error(403, "not_owner", "That Plex server isn't one of yours")
        # The owner's token is kept as PLEX_SERVER_TOKEN would be: it finds the owner
        values = {
            "plex_auth_enabled": True,
            "plex_server_machine_id": server.machine_id,
            "plex_server_token": request.auth_token,
            "plex_admin_ids": [account.id],
        }
        claims = {"sub": account.username, "role": "admin", "plex_id": account.id}
        server_name = server.name

    def record_claim(draft: SettingsDocument) -> None:
        # Under the store's lock: the check that makes one of two racing claims lose
        _require_unclaimed()
        draft.setup.claimed_at = datetime.now(UTC)
        draft.setup.claimed_by = str(claims["sub"])
        if server_name is not None:
            draft.plex_server_name = server_name

    try:
        await config_apply.apply(values, edit=record_claim)
    except OSError as err:
        log.error("Setup claim not saved: {}", err)
        raise _error(500, "write_failed", "The settings couldn't be saved") from err

    log.bind(event="setup.claimed", method=request.method, user=claims["sub"]).info(
        "Setup claimed by {} ({})", claims["sub"], request.method
    )
    return TokenResponse(access_token=create_access_token(claims), role="admin")


async def _count(source_url: str, fetch: Callable[[], Awaitable[int]]) -> int | None:
    if not source_url:
        return None
    try:
        async with asyncio.timeout(FACTS_TIMEOUT_SECONDS):
            return await fetch()
    except Exception:
        # The facts are a courtesy: a slow or failing source is left out
        return None


async def _dispatcharr_channels() -> int:
    catalogue = await get_grouped_channels()
    return sum(len(group.channels) for group in catalogue.groups) + len(catalogue.ungrouped)


async def _ersatztv_channels() -> int:
    return len(await run_feed_lookup(get_channels))


@router.post("/complete", response_model=SetupCompleteResponse)
async def complete(admin: TokenPayload = Depends(require_admin)) -> SetupCompleteResponse:
    """Finish setup: members can sign in from now on. Safe to repeat.

    Returns:
        Facts for the On air screen.

    Raises:
        HTTPException: 409 when setup isn't this app's to finish (sign-in is set
            in the environment); 500 when the settings can't be saved.
    """
    if settings_store.auth_env_managed() or not settings.state_file:
        raise _error(409, "env_managed", "Sign-in is set in the server's environment")
    if settings_store.setup_state() == "claimed":
        try:
            async with settings_store.edit() as draft:
                draft.setup.completed_at = datetime.now(UTC)
        except OSError as err:
            log.error("Setup completion not saved: {}", err)
            raise _error(500, "write_failed", "The settings couldn't be saved") from err
        log.bind(event="setup.completed", user=admin.sub).info("Setup completed by {}", admin.sub)

    dispatcharr, ersatztv = await asyncio.gather(
        _count(settings.dispatcharr_url, _dispatcharr_channels),
        _count(settings.ersatztv_base_url, _ersatztv_channels),
    )
    gifs = bool(settings.giphy_api_key and settings.giphy_api_key.get_secret_value())
    return SetupCompleteResponse(
        dispatcharr_channels=dispatcharr,
        ersatztv_channels=ersatztv,
        plex_server_name=settings_store.plex_server_name() if settings.plex_auth_enabled else None,
        features=SetupFeatures(
            chat=settings.chat_enabled,
            gifs=settings.chat_enabled and gifs,
            clips=settings.highlight_enabled,
            feedback=settings.ntfy_available,
        ),
    )
