"""Admin models for user presence tracking."""

from datetime import datetime

from pydantic import BaseModel, Field


class ActiveUser(BaseModel):
    """Represents an active user in the presence system."""

    username: str
    channel: str | None = None
    channel_id: str | None = Field(None, alias="channelId")
    # Following the shared Live slot, not a personal pick of whatever channel
    on_live: bool = Field(False, alias="onLive")
    programme: str | None = None
    connected_since: datetime = Field(alias="connectedSince")

    model_config = {"populate_by_name": True}


class ActiveUsersTotals(BaseModel):
    """Aggregate totals for active users."""

    live_count: int = Field(alias="liveCount")
    ersatztv_count: int = Field(alias="ersatztvCount")

    model_config = {"populate_by_name": True}


class ActiveUsersResponse(BaseModel):
    """Response model for GET /api/admin/active-users endpoint."""

    live_users: list[ActiveUser] = Field(alias="liveUsers")
    ersatztv_users: list[ActiveUser] = Field(alias="ersatztvUsers")
    totals: ActiveUsersTotals

    model_config = {"populate_by_name": True}


class AppSettings(BaseModel):
    """Runtime settings an admin can toggle for all users."""

    user_channel_selection: bool = Field(alias="userChannelSelection")
    # Whether members see which channel everyone else is watching (off: names only)
    presence_visible: bool = Field(alias="presenceVisible")

    model_config = {"populate_by_name": True}


class UpdateAppSettingsRequest(BaseModel):
    """Request body for PUT /api/settings. Omitted fields are left unchanged."""

    user_channel_selection: bool | None = Field(None, alias="userChannelSelection")
    presence_visible: bool | None = Field(None, alias="presenceVisible")

    model_config = {"populate_by_name": True}
