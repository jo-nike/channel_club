"""Auth dependency functions for protected routes."""

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from loguru import logger

from app.config import settings
from app.models.auth import TokenPayload
from app.services import app_settings
from app.services.auth import verify_token

log = logger.bind(router="auth_deps")
security = HTTPBearer()
security_optional = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> TokenPayload:
    """Extract and verify JWT token from Authorization header.

    Args:
        credentials: HTTP Bearer credentials from request.

    Returns:
        TokenPayload with user information.

    Raises:
        HTTPException: 401 if token is invalid or expired.
    """
    token = credentials.credentials
    try:
        return verify_token(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from None


async def get_current_user_or_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_optional),
    token: str | None = Query(default=None),
) -> TokenPayload:
    """Extract and verify JWT token from header OR query param.

    For HLS streaming, the browser fetches segments directly and cannot
    include Authorization headers. This allows passing token as query param.

    Args:
        credentials: Optional HTTP Bearer credentials from request.
        token: Optional token from query parameter.

    Returns:
        TokenPayload with user information.

    Raises:
        HTTPException: 401 if no valid token found.
    """
    # Try header first
    if credentials is not None:
        try:
            return verify_token(credentials.credentials)
        except JWTError:
            pass  # Fall through to try query param

    # Try query param
    if token is not None:
        try:
            return verify_token(token)
        except JWTError:
            pass

    # Neither worked
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
    )


def _admin_in_current_config(username: str) -> bool:
    """Return True if the CURRENT configuration could still grant this subject admin.

    The role is baked into a long-lived token at login, so a config change that
    revokes admin would otherwise persist until the token expires. This re-derives
    the grant from settings on every admin request. It is deliberately fail-safe:
    it returns True whenever *any* current source could mint admin for this
    subject, so a legitimate admin is never locked out by a grant the token alone
    cannot prove. Only a subject with no possible current admin source is treated
    as a stale claim.

    Sources that mint role="admin" (routers.auth.login + services.plex.determine_role):
      - the local admin username (ADMIN_USERNAME)
      - the Plex admin username list (PLEX_ADMIN_USERS_STR)
      - PLEX_DEFAULT_ROLE == "admin" (every authenticated Plex user is admin)
      - the Plex server owner: a live plex.tv lookup keyed on the Plex user *id*,
        which TokenPayload does not carry, so it cannot be re-derived here

    All checks read from settings, so this costs no network call.
    """
    if username == settings.admin_username:
        return True
    if username in settings.plex_admin_users:
        return True
    # Everyone-is-admin, or an owner grant we cannot disprove without the Plex
    # user id + a live plex.tv lookup — trust the claim rather than risk locking
    # the real server owner out. Residual staleness (a demoted owner, or a user
    # whose Plex share was revoked, keeps admin until the token expires) is the
    # accepted stateless-JWT tradeoff; closing it needs a session store or a
    # per-request Plex re-check.
    return bool(
        settings.plex_auth_enabled
        and (settings.plex_default_role == "admin" or settings.plex_server_token)
    )


async def require_admin(
    current_user: TokenPayload = Depends(get_current_user),
) -> TokenPayload:
    """Verify user has admin role.

    The role is baked into the token at login and the token lives for days, so
    the claim alone is not fully trusted: it is re-derived against the current
    configuration, which demotes a user removed from ADMIN_USERNAME or
    PLEX_ADMIN_USERS_STR on their very next request instead of at expiry. The
    re-derivation is fail-safe (see _admin_in_current_config) so it can never
    lock out a legitimately-configured admin.

    Args:
        current_user: The authenticated user from get_current_user.

    Returns:
        TokenPayload if user is admin.

    Raises:
        HTTPException: 403 if user is not admin.
    """
    if current_user.role != "admin":
        log.warning("Unauthorized admin access attempt by user: {}", current_user.sub)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    if _admin_in_current_config(current_user.sub):
        return current_user

    # role="admin" in the token, but no current configuration could grant it to
    # this subject: they were removed from the admin list since login.
    log.warning("Stale admin claim rejected for user: {}", current_user.sub)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin access required",
    )


async def require_channel_control(
    current_user: TokenPayload = Depends(get_current_user),
) -> TokenPayload:
    """Verify the user may change the live channel.

    Admins always may. Other users may only when an admin has enabled the
    user_channel_selection setting.

    Args:
        current_user: The authenticated user from get_current_user.

    Returns:
        TokenPayload if the user may change the live channel.

    Raises:
        HTTPException: 403 if the user is not allowed to change the channel.
    """
    if current_user.role == "admin" and _admin_in_current_config(current_user.sub):
        return current_user

    if app_settings.user_channel_selection_enabled():
        return current_user

    log.warning("Unauthorized channel change attempt by user: {}", current_user.sub)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Channel selection is restricted to admins",
    )
