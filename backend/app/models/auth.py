"""Authentication models for JWT token handling."""

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.base import CamelModel
from app.models.setup import SetupState


class LoginRequest(BaseModel):
    """Request model for login endpoint."""

    username: str = Field(max_length=256)
    password: str = Field(max_length=256)


class TokenResponse(CamelModel):
    """Response model for successful authentication."""

    access_token: str
    token_type: str = "bearer"
    role: str


def account_key(sub: str, plex_id: str | None) -> str:
    """The stable key for a signed-in account: its Plex id, else its username."""
    return f"plex:{plex_id}" if plex_id else f"local:{sub}"


class TokenPayload(BaseModel):
    """JWT token payload structure."""

    sub: str  # username
    role: str  # "admin" or "viewer"
    exp: datetime
    # Plex account id, present on Plex sign-ins. Unlike the username (sub) it
    # survives a Plex rename, so it is the stable way to tell accounts apart.
    plex_id: str | None = None
    # When the person originally signed in. Refreshes keep it, so it caps how
    # long a session can be renewed. None on tokens issued before it existed.
    auth_time: datetime | None = None

    @property
    def account_key(self) -> str:
        """The stable key for this account (see account_key)."""
        return account_key(self.sub, self.plex_id)


class AuthConfigResponse(CamelModel):
    """Response for GET /api/auth/config."""

    local_auth_enabled: bool
    plex_auth_enabled: bool
    # Signed-out clients go to /setup while this is unclaimed
    setup_state: SetupState
