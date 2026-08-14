"""Settings router for runtime options an admin can toggle for all users."""

from fastapi import APIRouter, Depends
from loguru import logger

from app.models.admin import AppSettings, UpdateAppSettingsRequest
from app.models.auth import TokenPayload
from app.routers.auth_deps import get_current_user, require_admin
from app.services import app_settings

router = APIRouter(tags=["settings"])
log = logger.bind(router="settings")


@router.get("/settings", response_model=AppSettings)
async def get_settings(
    current_user: TokenPayload = Depends(get_current_user),
) -> AppSettings:
    """Get the current runtime settings.

    Requires JWT authentication. Readable by any user, since viewers need to
    know whether they are allowed to change the live channel.

    Args:
        current_user: Authenticated user from JWT token.

    Returns:
        AppSettings with the current values.
    """
    log.debug("GET /settings request")
    return app_settings.get_app_settings()


@router.put("/settings", response_model=AppSettings)
async def update_settings(
    request: UpdateAppSettingsRequest,
    current_user: TokenPayload = Depends(require_admin),
) -> AppSettings:
    """Update runtime settings (admin only).

    Requires admin role. Omitted fields are left unchanged. Broadcasts the new
    settings to all WebSocket clients.

    Args:
        request: Settings to update.
        current_user: Authenticated admin user from JWT token.

    Returns:
        The updated settings.
    """
    if request.user_channel_selection is not None:
        return await app_settings.set_user_channel_selection(
            request.user_channel_selection, user=current_user.sub
        )

    return app_settings.get_app_settings()
