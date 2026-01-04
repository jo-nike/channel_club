"""Authentication models for JWT token handling."""

from datetime import datetime

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """Request model for login endpoint."""

    username: str
    password: str


class TokenResponse(BaseModel):
    """Response model for successful authentication."""

    access_token: str = Field(alias="accessToken")
    token_type: str = Field(default="bearer", alias="tokenType")
    role: str

    model_config = {"populate_by_name": True}


class TokenPayload(BaseModel):
    """JWT token payload structure."""

    sub: str  # username
    role: str  # "admin" or "viewer"
    exp: datetime


class AuthConfigResponse(BaseModel):
    """Response for GET /api/auth/config."""

    local_auth_enabled: bool = Field(alias="localAuthEnabled")
    plex_auth_enabled: bool = Field(alias="plexAuthEnabled")

    model_config = {"populate_by_name": True}
