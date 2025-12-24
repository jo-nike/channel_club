"""JWT token service for authentication."""

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.config import settings
from app.models.auth import TokenPayload

JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_DAYS = 7


def create_access_token(data: dict) -> str:
    """Create a JWT access token with expiration.

    Args:
        data: Dictionary containing claims (sub, role).

    Returns:
        Encoded JWT token string.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRATION_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> TokenPayload:
    """Verify and decode a JWT token.

    Args:
        token: The JWT token string.

    Returns:
        TokenPayload with decoded claims.

    Raises:
        JWTError: If token is invalid or expired.
    """
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
    return TokenPayload(**payload)
