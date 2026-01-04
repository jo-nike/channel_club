"""JWT token service for authentication."""

from datetime import UTC, datetime, timedelta

from jose import jwt
from loguru import logger

from app.config import settings
from app.models.auth import TokenPayload

# Module-level logger with service context
log = logger.bind(service="auth")

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
    expire = datetime.now(UTC) + timedelta(days=JWT_EXPIRATION_DAYS)
    to_encode.update({"exp": expire})
    # Log token creation without exposing sensitive data
    log.debug("Creating access token for user with role '{}'", data.get("role", "unknown"))
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
    # Log only first 8 characters of token for debugging (never full token!)
    log.debug("Verifying token: {}...", token[:8] if token else "empty")
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
    token_payload = TokenPayload(**payload)
    log.debug("Token verified for user with role '{}'", token_payload.role)
    return token_payload
