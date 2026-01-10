"""Admin router for user presence and system management."""

from fastapi import APIRouter, Depends
from loguru import logger

from app.models.admin import ActiveUser, ActiveUsersResponse, ActiveUsersTotals
from app.models.auth import TokenPayload
from app.models.status import SystemStatusResponse
from app.routers.auth_deps import require_admin
from app.services import chat, presence, status_service

log = logger.bind(router="admin")
router = APIRouter(tags=["admin"])


@router.get("/active-users", response_model=ActiveUsersResponse)
async def get_active_users(
    current_user: TokenPayload = Depends(require_admin),
) -> ActiveUsersResponse:
    """Get all active users.

    Requires admin role.

    Returns:
        ActiveUsersResponse with live users, ersatztv users, and totals.
    """
    log.debug("Admin {} requesting active users", current_user.sub)

    # Clean up stale users before returning the list
    removed = presence.cleanup_stale_users()
    if removed > 0:
        log.info("Cleaned up {} stale users", removed)

    live_users = presence.get_users_by_view("live")
    ersatztv_users = presence.get_users_by_view("ersatztv")

    return ActiveUsersResponse(
        live_users=[
            ActiveUser(
                username=u.username,
                channel=u.current_channel,
                programme=u.current_programme,
                connected_since=u.connected_since,
            )
            for u in live_users
        ],
        ersatztv_users=[
            ActiveUser(
                username=u.username,
                channel=u.current_channel,
                programme=u.current_programme,
                connected_since=u.connected_since,
            )
            for u in ersatztv_users
        ],
        totals=ActiveUsersTotals(
            live_count=len(live_users),
            ersatztv_count=len(ersatztv_users),
        ),
    )


@router.get("/status", response_model=SystemStatusResponse)
async def get_system_status(
    current_user: TokenPayload = Depends(require_admin),
) -> SystemStatusResponse:
    """Get system status for external services.

    Requires admin role.

    Returns:
        SystemStatusResponse with ErsatzTV and Dispatcharr status.
    """
    log.debug("Admin {} requesting system status", current_user.sub)
    return await status_service.get_system_status()


@router.delete("/chat-history")
async def clear_chat_history(
    current_user: TokenPayload = Depends(require_admin),
) -> dict[str, str]:
    """Clear all chat message history.

    Requires admin role.

    Returns:
        Confirmation message.
    """
    log.info("Admin {} clearing chat history", current_user.sub)
    chat.clear_history()
    return {"message": "Chat history cleared"}
