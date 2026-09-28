"""Auth router for JWT token authentication."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger

from app.config import settings
from app.models.auth import AuthConfigResponse, LoginRequest, TokenPayload, TokenResponse
from app.models.plex import PlexAuthRequest, PlexUser
from app.routers.auth_deps import get_current_user
from app.services import plex
from app.services.auth import JWT_EXPIRATION_DAYS, SESSION_MAX_AGE_DAYS, create_access_token
from app.services.plex import (
    InvalidPlexTokenError,
    PlexUnavailableError,
    check_server_access,
    determine_role,
    validate_plex_token,
)

router = APIRouter(tags=["auth"])
log = logger.bind(router="auth")


@router.get("/config", response_model=AuthConfigResponse)
async def get_auth_config() -> AuthConfigResponse:
    """Return available authentication methods."""
    log.debug("Auth config requested")
    return AuthConfigResponse(
        local_auth_enabled=settings.local_auth_enabled,
        plex_auth_enabled=settings.plex_auth_enabled,
    )


@router.post("/token", response_model=TokenResponse)
async def login(request: LoginRequest) -> TokenResponse:
    """Authenticate user and return JWT token.

    Args:
        request: Login credentials (username, password).

    Returns:
        TokenResponse with access token and role.

    Raises:
        HTTPException: 404 if local auth is disabled.
        HTTPException: 401 if credentials are invalid.
    """
    # Log at most 64 characters of the username: anyone can post one.
    log_username = request.username[:64]
    log.debug("Login attempt for user: {}", log_username)

    # Check if local auth is enabled
    if not settings.local_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Check admin credentials
    if (
        settings.admin_password
        and request.username == settings.admin_username
        and request.password == settings.admin_password
    ):
        role = "admin"
    # Check viewer credentials
    elif (
        settings.viewer_password
        and request.username == settings.viewer_username
        and request.password == settings.viewer_password
    ):
        role = "viewer"
    else:
        log.warning("Failed login attempt for user: {}", log_username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    log.info("User {} logged in successfully with role {}", log_username, role)
    token = create_access_token({"sub": request.username, "role": role})
    return TokenResponse(access_token=token, role=role)


@router.post("/plex", response_model=TokenResponse)
async def login_with_plex(request: PlexAuthRequest) -> TokenResponse:
    """Authenticate using Plex token.

    Args:
        request: Plex authentication request with authToken.

    Returns:
        TokenResponse with JWT access token and role.

    Raises:
        HTTPException: 404 if Plex auth is disabled.
        HTTPException: 401 if Plex token is invalid.
        HTTPException: 403 if user lacks access to configured server.
        HTTPException: 503 if plex.tv is unreachable or misbehaving.
    """
    log.debug("Plex auth attempt")

    # Check if Plex auth is enabled
    if not settings.plex_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Validate Plex token and check server access
    try:
        plex_user = await validate_plex_token(request.auth_token)
        has_access = await check_server_access(request.auth_token)
    except InvalidPlexTokenError as err:
        log.warning("Plex auth failed: invalid or expired token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Plex token",
        ) from err
    except PlexUnavailableError as err:
        log.warning("Plex auth failed: plex.tv unavailable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Plex is not responding, try again shortly",
        ) from err

    if not has_access:
        log.warning("Plex auth failed for user {}: no server access", plex_user.username)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access to Plex server",
        )

    # Determine role based on configuration and ownership
    role = await determine_role(plex_user)

    log.info("Plex user {} logged in successfully with role {}", plex_user.username, role)
    token = create_access_token({"sub": plex_user.username, "role": role, "plex_id": plex_user.id})
    return TokenResponse(access_token=token, role=role)


async def _current_role(user: TokenPayload) -> str | None:
    """Re-derive a token holder's role from today's configuration, as sign-in would.

    Args:
        user: The verified token being refreshed.

    Returns:
        The role, or None if no current sign-in method would admit this user.

    Raises:
        HTTPException: 503 if an admin Plex token can't be checked because the
            plex.tv owner lookup got no answer.
    """
    if user.plex_id is None:
        if not settings.local_auth_enabled:
            return None
        if settings.admin_password and user.sub == settings.admin_username:
            return "admin"
        if settings.viewer_password and user.sub == settings.viewer_username:
            return "viewer"
        return None
    if not settings.plex_auth_enabled:
        return None
    if (
        user.role == "admin"
        and settings.plex_server_token
        and await plex.get_server_owner_id() is None
    ):
        # This may be the owner, and determine_role would fall back to the default
        # role. Refuse for now rather than demote them: the client keeps its token
        # and retries, and require_admin trusts the claim in the meantime.
        log.warning("Refresh deferred for user {}: Plex owner lookup failed", user.sub)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Plex is not responding, try again shortly",
        )
    return await determine_role(PlexUser(id=user.plex_id, username=user.sub, email=""))


@router.post("/refresh", response_model=TokenResponse)
async def refresh(current_user: TokenPayload = Depends(get_current_user)) -> TokenResponse:
    """Swap a valid session token for a fresh one with the same sign-in time.

    An expired token cannot refresh, and no token refreshes more than
    SESSION_MAX_AGE_DAYS after the original sign-in. The role is re-derived,
    so a demoted admin comes back as a viewer.

    Args:
        current_user: The verified token being refreshed.

    Returns:
        TokenResponse with the new access token and role.

    Raises:
        HTTPException: 401 if the session is past its cap or the user no
            longer has a way to sign in.
        HTTPException: 503 if plex.tv can't confirm an admin Plex token's role.
    """
    # Tokens issued before auth_time existed were signed JWT_EXPIRATION_DAYS
    # before they expire
    auth_time = current_user.auth_time or current_user.exp - timedelta(days=JWT_EXPIRATION_DAYS)
    if datetime.now(UTC) > auth_time + timedelta(days=SESSION_MAX_AGE_DAYS):
        log.info("Refresh refused for user {}: sign-in is too old", current_user.sub)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign-in expired",
        )

    role = await _current_role(current_user)
    if role is None:
        log.warning("Refresh refused for user {}: no longer allowed to sign in", current_user.sub)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    claims: dict[str, object] = {
        "sub": current_user.sub,
        "role": role,
        "auth_time": int(auth_time.timestamp()),
    }
    if current_user.plex_id is not None:
        claims["plex_id"] = current_user.plex_id
    log.debug("Token refreshed for user {} with role {}", current_user.sub, role)
    return TokenResponse(access_token=create_access_token(claims), role=role)
