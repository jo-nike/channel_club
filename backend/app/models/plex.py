"""Plex authentication models."""

from pydantic import BaseModel, Field


class PlexAuthRequest(BaseModel):
    """Request body for Plex authentication."""

    auth_token: str = Field(alias="authToken")

    model_config = {"populate_by_name": True}


class PlexUser(BaseModel):
    """Plex user information from API response."""

    id: str
    username: str
    email: str
    thumb: str | None = None
