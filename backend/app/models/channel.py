"""Channel models for IPTV Viewer API."""

from pydantic import BaseModel, Field


class DispatchrrChannel(BaseModel):
    """Raw channel data from Dispatcharr lineup.json (HDHomeRun format)."""

    guide_number: str = Field(alias="GuideNumber")
    guide_name: str = Field(alias="GuideName")
    url: str = Field(alias="URL")
    guide_id: str = Field(alias="Guide_ID")

    model_config = {"populate_by_name": True}


class Channel(BaseModel):
    """Transformed channel for our API with camelCase JSON serialization."""

    id: str
    name: str
    stream_url: str = Field(alias="streamUrl")
    guide_id: str = Field(alias="guideId")

    model_config = {"populate_by_name": True}


class SetChannelRequest(BaseModel):
    """Request body for PUT /api/channels/current."""

    id: str
    name: str
    stream_url: str = Field(alias="streamUrl")
    guide_id: str = Field(alias="guideId")

    model_config = {"populate_by_name": True}


class CurrentChannelResponse(BaseModel):
    """Response for GET /api/channels/current."""

    current_channel: Channel | None = Field(None, alias="currentChannel")

    model_config = {"populate_by_name": True}
