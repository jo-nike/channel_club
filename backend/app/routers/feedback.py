"""Feedback API: viewers send bug reports and suggestions to the operator via ntfy."""

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger

from app.config import settings
from app.models.auth import TokenPayload
from app.models.feedback import (
    MAX_CONTACT_LENGTH,
    MAX_MESSAGE_LENGTH,
    FeedbackContext,
    FeedbackFeatureResponse,
    FeedbackRequest,
    FeedbackResponse,
)
from app.routers.auth_deps import get_current_user
from app.services import feedback

router = APIRouter(prefix="/api/feedback", tags=["feedback"])
log = logger.bind(router="feedback")


@router.get("/feature", response_model=FeedbackFeatureResponse)
async def get_feature_status(
    user: TokenPayload = Depends(get_current_user),
) -> FeedbackFeatureResponse:
    """Tell the frontend whether to show the feedback button."""
    log.debug("GET /feedback/feature request")
    return FeedbackFeatureResponse(enabled=settings.ntfy_available)


@router.post("", response_model=FeedbackResponse)
async def submit_feedback(
    request: FeedbackRequest,
    user: TokenPayload = Depends(get_current_user),
) -> FeedbackResponse:
    """Deliver one report. Disabled requests never contact ntfy."""
    if not settings.ntfy_available:
        raise HTTPException(503, "Feedback is disabled or not configured")

    message = feedback.sanitize_text(request.message, MAX_MESSAGE_LENGTH)
    if not message:
        raise HTTPException(422, "Message is empty")
    contact = feedback.sanitize_text(request.contact, MAX_CONTACT_LENGTH, multiline=False)
    context = FeedbackContext(
        user_agent=feedback.sanitize_text(request.context.user_agent, 300, multiline=False),
        viewport=feedback.sanitize_text(request.context.viewport, 32, multiline=False),
        path=feedback.sanitize_text(request.context.path, 200, multiline=False),
        session_id=feedback.sanitize_text(request.context.session_id, 16, multiline=False),
        app_version=feedback.sanitize_text(request.context.app_version, 32, multiline=False),
    )

    feedback.reserve(user.account_key)
    try:
        await feedback.publish(
            feedback.build_message(
                kind=request.kind,
                message=message,
                contact=contact,
                username=user.sub,
                role=user.role,
                context=context,
            )
        )
    except HTTPException as exc:
        if exc.status_code >= 500 or exc.status_code == 429:
            feedback.release(user.account_key)
        raise

    log.info("Feedback ({}) delivered for user '{}'", request.kind, user.sub)
    return FeedbackResponse()
