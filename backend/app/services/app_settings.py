"""Runtime app settings that an admin can toggle for all users.

The values live in memory and are saved to the state file (state_store) on
every change, so they survive a restart. Changes are broadcast over the
existing WebSocket so connected clients react without a refresh.
"""

from loguru import logger

from app.models.admin import AppSettings
from app.models.websocket import ServerSettingsUpdate
from app.services import channel_state, state_store

# Module-level logger with service context
log = logger.bind(service="app_settings")

# In-memory state, saved to and restored from the state file
_user_channel_selection: bool = False
# Presence ships dark: members see who is online, not what they watch, until an
# admin turns this on (after asking the group)
_presence_visible: bool = False


def restore_app_settings(state: dict) -> None:
    """Apply the settings loaded from the state file, before the app serves.

    Args:
        state: The document from state_store.load().
    """
    global _user_channel_selection, _presence_visible
    _user_channel_selection = state["userChannelSelection"]
    _presence_visible = state["presenceVisible"]


def get_app_settings() -> AppSettings:
    """Get the current runtime settings.

    Returns:
        AppSettings with the current values.
    """
    return AppSettings(
        user_channel_selection=_user_channel_selection,
        presence_visible=_presence_visible,
    )


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

    await state_store.save({"userChannelSelection": enabled})
    await broadcast_settings_update()

    return get_app_settings()


def presence_visible_enabled() -> bool:
    """Check whether members may see which channel everyone else is watching.

    Returns:
        True if the presence snapshot includes channels, False for names only.
    """
    return _presence_visible


async def set_presence_visible(enabled: bool, user: str | None = None) -> AppSettings:
    """Set whether members see what everyone is watching, and broadcast it.

    Args:
        enabled: True to share each member's channel and programme with everyone.
        user: Optional username of the admin making the change.

    Returns:
        The updated settings.
    """
    global _presence_visible
    _presence_visible = enabled

    if user:
        log.info("Presence visibility set to {} by user '{}'", enabled, user)
    else:
        log.info("Presence visibility set to {}", enabled)

    await state_store.save({"presenceVisible": enabled})
    await broadcast_settings_update()

    return get_app_settings()


async def broadcast_settings_update() -> None:
    """Broadcast the current settings to all connected clients."""
    await channel_state.broadcast(
        ServerSettingsUpdate(type="settings_update", settings=get_app_settings())
    )
