"""Channel models for IPTV Viewer API."""

from typing import Optional

from pydantic import BaseModel, Field


class DispatchrrChannel(BaseModel):
    """Raw channel data from Dispatcharr lineup.json (HDHomeRun format)."""

    guide_number: str = Field(alias="GuideNumber")
    guide_name: str = Field(alias="GuideName")
    url: str = Field(alias="URL")

    model_config = {"populate_by_name": True}


class Channel(BaseModel):
    """Transformed channel for our API with camelCase JSON serialization."""

    id: str
    name: str
    stream_url: str = Field(alias="streamUrl")

    model_config = {"populate_by_name": True}


class SetChannelRequest(BaseModel):
    """Request body for PUT /api/channels/current."""

    id: str
    name: str
    stream_url: str = Field(alias="streamUrl")

    model_config = {"populate_by_name": True}


class CurrentChannelResponse(BaseModel):
    """Response for GET /api/channels/current."""

    current_channel: Optional[Channel] = Field(None, alias="currentChannel")

    model_config = {"populate_by_name": True}
