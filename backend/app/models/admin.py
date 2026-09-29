"""Admin models for user presence tracking."""

from datetime import datetime

from pydantic import ConfigDict

from app.models.base import CamelModel


class ActiveUser(CamelModel):
    """Represents an active user in the presence system."""

    username: str
    channel: str | None = None
    channel_id: str | None = None
    # Following the shared Live slot, not a personal pick of whatever channel
    on_live: bool = False
    programme: str | None = None
    connected_since: datetime


class ActiveUsersTotals(CamelModel):
    """Aggregate totals for active users."""

    live_count: int
    ersatztv_count: int


class ActiveUsersResponse(CamelModel):
    """Response model for GET /api/admin/active-users endpoint."""

    live_users: list[ActiveUser]
    ersatztv_users: list[ActiveUser]
    totals: ActiveUsersTotals


class AppSettings(CamelModel):
    """Runtime settings an admin can toggle for all users."""

    user_channel_selection: bool
    # Whether members see which channel everyone else is watching (off: names only)
    presence_visible: bool


class UpdateAppSettingsRequest(CamelModel):
    """Request body for PUT /api/settings. Omitted fields are left unchanged."""

    user_channel_selection: bool | None = None
    presence_visible: bool | None = None

    model_config = ConfigDict(extra="forbid")
