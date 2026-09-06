"""Auth router for JWT token authentication."""

from fastapi import APIRouter, HTTPException, status
from loguru import logger

from app.config import settings
from app.models.auth import AuthConfigResponse, LoginRequest, TokenResponse
from app.models.plex import PlexAuthRequest
from app.services.auth import create_access_token
from app.services.plex import (
    InvalidPlexTokenError,
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
    log.debug("Login attempt for user: {}", request.username)

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
        log.warning("Failed login attempt for user: {}", request.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    log.info("User {} logged in successfully with role {}", request.username, role)
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
    """
    log.debug("Plex auth attempt")

    # Check if Plex auth is enabled
    if not settings.plex_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Validate Plex token
    try:
        plex_user = await validate_plex_token(request.auth_token)
    except InvalidPlexTokenError as err:
        log.warning("Plex auth failed: invalid or expired token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Plex token",
        ) from err

    # Check server access
    has_access = await check_server_access(request.auth_token)
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
