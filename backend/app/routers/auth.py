"""Auth router for JWT token authentication."""

from fastapi import APIRouter, HTTPException, status

from app.config import settings
from app.models.auth import LoginRequest, TokenResponse
from app.services.auth import create_access_token

router = APIRouter(tags=["auth"])


@router.post("/token", response_model=TokenResponse)
async def login(request: LoginRequest) -> TokenResponse:
    """Authenticate user and return JWT token.

    Args:
        request: Login credentials (username, password).

    Returns:
        TokenResponse with access token and role.

    Raises:
        HTTPException: 401 if credentials are invalid.
    """
    # Check admin credentials
    if request.username == settings.admin_username and request.password == settings.admin_password:
        role = "admin"
    # Check viewer credentials
    elif (
        request.username == settings.viewer_username
        and request.password == settings.viewer_password
    ):
        role = "viewer"
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = create_access_token({"sub": request.username, "role": role})
    return TokenResponse(access_token=token, role=role)
