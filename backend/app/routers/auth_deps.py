"""Auth dependency functions for protected routes."""

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger

from app.config import settings
from app.models.auth import TokenPayload
from app.services import app_settings, plex
from app.services.auth import verify_token
from app.services.passwords import local_accounts

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
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from None


async def _admin_in_current_config(user: TokenPayload) -> bool:
    """Return True if the CURRENT configuration could still grant this user admin.

    The role is baked into a long-lived token at login, so a config change that
    revokes admin would otherwise persist until the token expires. This re-derives
    the grant from settings on every admin request. Only a user with no possible
    current admin source is treated as a stale claim.

    Sources that mint role="admin" (routers.auth.login + services.plex.determine_role):
      - the local admin username (ADMIN_USERNAME), for a local token (no plex_id),
        while local sign-in is on and the admin account has a password
      - the Plex admin username list (PLEX_ADMIN_USERS_STR)
      - the Plex account ids picked as admins in the UI (plex_admin_ids)
      - the Plex server owner: the token's plex_id must equal the owner id from
        plex.tv (cached, and warmed at boot)

    Only the owner check can cost a network call, and only on a cold cache.
    """
    if user.plex_id is None and settings.local_auth_enabled:
        admin = local_accounts(settings)[0]
        if admin.usable and user.sub == admin.username:
            return True
    if user.sub in settings.plex_admin_users:
        return True
    if not settings.plex_auth_enabled:
        return False
    if user.plex_id is not None and user.plex_id in settings.plex_admin_ids:
        return True
    # The owner clause covers Plex sign-ins only: a token without a plex_id
    # cannot be the owner's.
    server_token = settings.plex_server_token
    if not (server_token and server_token.get_secret_value()) or user.plex_id is None:
        return False
    owner_id = await plex.get_server_owner_id()
    if owner_id is None:
        # plex.tv did not answer: trust a Plex token's claim rather than lock
        # the real owner out. Residual staleness (a demoted owner, or a user
        # whose Plex share was revoked, keeps admin until the token expires) is
        # the accepted stateless-JWT tradeoff.
        return True
    return user.plex_id == owner_id


async def require_admin(
    current_user: TokenPayload = Depends(get_current_user),
) -> TokenPayload:
    """Verify user has admin role.

    The role is baked into the token at login and the token lives for days, so
    the claim alone is not fully trusted: it is re-derived against the current
    configuration, which demotes a user removed from ADMIN_USERNAME or
    PLEX_ADMIN_USERS_STR on their very next request instead of at expiry. The
    server owner is recognised by Plex account id, so it can never lock out a
    legitimately-configured admin (see _admin_in_current_config).

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

    if await _admin_in_current_config(current_user):
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
    if current_user.role == "admin" and await _admin_in_current_config(current_user):
        return current_user

    if app_settings.user_channel_selection_enabled():
        return current_user

    log.warning("Unauthorized channel change attempt by user: {}", current_user.sub)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Channel selection is restricted to admins",
    )
