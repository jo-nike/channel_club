"""Auth dependency functions for protected routes."""

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from loguru import logger

from app.models.auth import TokenPayload
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


async def require_admin(
    current_user: TokenPayload = Depends(get_current_user),
) -> TokenPayload:
    """Verify user has admin role.

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
    return current_user
