"""Plex authentication models."""

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.base import CamelModel


class PlexAuthRequest(CamelModel):
    """Request body for Plex authentication."""

    # Printable ASCII only: it becomes the X-Plex-Token header, where anything else
    # fails in httpx as a 500 (non-ASCII) or a misleading 'Plex is not responding' (CR/LF)
    auth_token: str = Field(max_length=512, pattern=r"^[\x21-\x7e]+$")


class PlexUser(BaseModel):
    """Plex user information from API response."""

    id: str
    username: str
    email: str
    thumb: str | None = None


class PlexServer(CamelModel):
    """A Plex Media Server the signed-in account owns, as the setup picker shows it.

    Deliberately narrow: plex.tv's resource also carries the server's access
    token and its addresses, and neither may reach a browser.
    """

    machine_id: str
    name: str
    online: bool
    last_seen_at: datetime | None = None
    # People the server is shared with; None when plex.tv's user list couldn't be read
    member_count: int | None = None


class PlexMember(CamelModel):
    """Someone who can reach a server: its owner, or a person it is shared with."""

    plex_id: str
    username: str
    # A Plex Home managed user
    managed: bool = False
    owner: bool = False
