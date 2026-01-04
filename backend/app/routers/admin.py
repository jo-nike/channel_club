"""Admin router for user presence and system management."""

from fastapi import APIRouter, Depends
from loguru import logger

from app.models.admin import ActiveUser, ActiveUsersResponse, ActiveUsersTotals
from app.models.auth import TokenPayload
from app.routers.auth_deps import require_admin
from app.services import presence

log = logger.bind(router="admin")
router = APIRouter(tags=["admin"])


@router.get("/active-users", response_model=ActiveUsersResponse)
async def get_active_users(
    current_user: TokenPayload = Depends(require_admin),
) -> ActiveUsersResponse:
    """Get all active users with bitrate information.

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

    live_bitrate = sum(u.estimated_bitrate for u in live_users)
    ersatztv_bitrate = sum(u.estimated_bitrate for u in ersatztv_users)

    return ActiveUsersResponse(
        live_users=[
            ActiveUser(
                username=u.username,
                channel=u.current_channel,
                connected_since=u.connected_since,
                bitrate_mbps=u.estimated_bitrate,
            )
            for u in live_users
        ],
        ersatztv_users=[
            ActiveUser(
                username=u.username,
                channel=u.current_channel,
                connected_since=u.connected_since,
                bitrate_mbps=u.estimated_bitrate,
            )
            for u in ersatztv_users
        ],
        totals=ActiveUsersTotals(
            live_count=len(live_users),
            ersatztv_count=len(ersatztv_users),
            live_bitrate_mbps=live_bitrate,
            ersatztv_bitrate_mbps=ersatztv_bitrate,
            total_bitrate_mbps=live_bitrate + ersatztv_bitrate,
        ),
    )
