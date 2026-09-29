"""Feedback models: what a viewer submits and what the API answers."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.base import CamelModel

FeedbackKind = Literal["bug", "suggestion", "other"]

MAX_MESSAGE_LENGTH = 2000
MAX_CONTACT_LENGTH = 200
# Loose input bound for each context field; the router truncates to display caps
MAX_CONTEXT_FIELD_LENGTH = 2000


class FeedbackContext(CamelModel):
    """Client diagnostics attached to a report. Every field is bounded."""

    user_agent: str = Field(default="", max_length=MAX_CONTEXT_FIELD_LENGTH)
    viewport: str = Field(default="", max_length=MAX_CONTEXT_FIELD_LENGTH)  # "1920x1080"
    # pathname only, never the query string
    path: str = Field(default="", max_length=MAX_CONTEXT_FIELD_LENGTH)
    session_id: str = Field(default="", max_length=MAX_CONTEXT_FIELD_LENGTH)
    # frontend build
    app_version: str = Field(default="", max_length=MAX_CONTEXT_FIELD_LENGTH)

    model_config = ConfigDict(extra="forbid")


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
