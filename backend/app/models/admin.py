"""Admin models for user presence and bitrate tracking."""

from datetime import datetime

from pydantic import BaseModel, Field


class ActiveUser(BaseModel):
    """Represents an active user in the presence system."""

    username: str
    channel: str | None = None
    connected_since: datetime = Field(alias="connectedSince")
    bitrate_mbps: float = Field(alias="bitrateMbps")

    model_config = {"populate_by_name": True}


class ActiveUsersTotals(BaseModel):
    """Aggregate totals for active users."""

    live_count: int = Field(alias="liveCount")
    ersatztv_count: int = Field(alias="ersatztvCount")
    live_bitrate_mbps: float = Field(alias="liveBitrateMbps")
    ersatztv_bitrate_mbps: float = Field(alias="ersatztvBitrateMbps")
    total_bitrate_mbps: float = Field(alias="totalBitrateMbps")

    model_config = {"populate_by_name": True}


class ActiveUsersResponse(BaseModel):
    """Response model for GET /api/admin/active-users endpoint."""

    live_users: list[ActiveUser] = Field(alias="liveUsers")
    ersatztv_users: list[ActiveUser] = Field(alias="ersatztvUsers")
    totals: ActiveUsersTotals

    model_config = {"populate_by_name": True}
