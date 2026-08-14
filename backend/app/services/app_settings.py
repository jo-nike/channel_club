"""Runtime app settings that an admin can toggle for all users.

Like channel_state, this is in-memory state that resets on server restart.
Changes are broadcast over the existing WebSocket so connected clients react
without a refresh.
"""

from loguru import logger

from app.models.admin import AppSettings
from app.services import channel_state

# Module-level logger with service context
log = logger.bind(service="app_settings")

# In-memory state - resets on restart
_user_channel_selection: bool = False


def get_app_settings() -> AppSettings:
    """Get the current runtime settings.

    Returns:
        AppSettings with the current values.
    """
    return AppSettings(user_channel_selection=_user_channel_selection)


def user_channel_selection_enabled() -> bool:
    """Check whether non-admin users may set the live channel.

    Returns:
        True if any authenticated user can change the live channel.
    """
    return _user_channel_selection


async def set_user_channel_selection(enabled: bool, user: str | None = None) -> AppSettings:
    """Set whether non-admin users may set the live channel, and broadcast it.

    Args:
        enabled: True to let any authenticated user change the live channel.
        user: Optional username of the admin making the change.

    Returns:
        The updated settings.
    """
    global _user_channel_selection
    _user_channel_selection = enabled

    if user:
        log.info("User channel selection set to {} by user '{}'", enabled, user)
    else:
        log.info("User channel selection set to {}", enabled)

    await broadcast_settings_update()

    return get_app_settings()


async def broadcast_settings_update() -> None:
    """Broadcast the current settings to all connected clients."""
    message = {
        "type": "settings_update",
        "settings": get_app_settings().model_dump(by_alias=True),
    }
    await channel_state.broadcast(message)


def reset() -> None:
    """Reset settings to their defaults (used by tests)."""
    global _user_channel_selection
    _user_channel_selection = False
