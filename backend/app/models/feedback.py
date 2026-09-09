"""Feedback models: what a viewer submits and what the API answers."""

from typing import Literal

from pydantic import BaseModel, Field

FeedbackKind = Literal["bug", "suggestion", "other"]

MAX_MESSAGE_LENGTH = 2000
MAX_CONTACT_LENGTH = 200


class FeedbackContext(BaseModel):
    """Client diagnostics attached to a report. Every field is bounded."""

    user_agent: str = Field("", alias="userAgent", max_length=300)
    viewport: str = Field("", max_length=32)  # "1920x1080"
    path: str = Field("", max_length=200)  # pathname only, never the query string
    session_id: str = Field("", alias="sessionId", max_length=16)
    app_version: str = Field("", alias="appVersion", max_length=32)  # frontend build

    model_config = {"populate_by_name": True, "extra": "forbid"}


class FeedbackRequest(BaseModel):
    """Request body for POST /api/feedback."""

    kind: FeedbackKind = Field(alias="type")
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)
    contact: str = Field("", max_length=MAX_CONTACT_LENGTH)
    context: FeedbackContext = Field(default_factory=lambda: FeedbackContext())

    model_config = {"populate_by_name": True, "extra": "forbid"}


class FeedbackFeatureResponse(BaseModel):
    """Response for GET /api/feedback/feature."""

    enabled: bool


class FeedbackResponse(BaseModel):
    """Response for a delivered report."""

    ok: bool = True
