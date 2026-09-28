"""Plex authentication models."""

from pydantic import BaseModel, Field


class PlexAuthRequest(BaseModel):
    """Request body for Plex authentication."""

    # Printable ASCII only: it becomes the X-Plex-Token header, where anything else
    # fails in httpx as a 500 (non-ASCII) or a misleading 'Plex is not responding' (CR/LF)
    auth_token: str = Field(alias="authToken", max_length=512, pattern=r"^[\x21-\x7e]+$")

    model_config = {"populate_by_name": True}


class PlexUser(BaseModel):
    """Plex user information from API response."""

    id: str
    username: str
    email: str
    thumb: str | None = None
