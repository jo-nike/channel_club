"""Auth dependency functions for protected routes."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError

from app.models.auth import TokenPayload
from app.services.auth import verify_token

security = HTTPBearer()


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
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user
