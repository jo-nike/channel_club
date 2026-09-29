"""Apply saved settings to the running app, so a change needs no restart.

Every module holds the one settings object and most read it per request, so
assigning a value is usually all it takes. This module does the rest: caches
that hold what an old address fetched, the Live channel, recorders and casts
still reading from an old address, features switched on or off, the Plex
owner lookup and the log level. The order:

1. Prepare features being switched on: their stale-file sweeps finish before
   the switch flips, so they can't delete what a new recorder or cast writes.
2. Validate the batch, write the file, then assign every value with no await
   in between (settings_store.edit).
3. Invalidate the caches the old values filled.
4. Tell every open tab when an optional feature switched on or off
   (features_update), so it shows only what the server has on.
5. Run the async side effects.
"""

import asyncio
from collections.abc import Callable, Mapping

from loguru import logger

from app.config import UiField, settings
from app.logging_config import configure_logging
from app.models.websocket import Features, ServerFeaturesUpdate
from app.services import channel_state, dispatcharr, plex, settings_store
from app.services.cast import cast_service
from app.services.epg_service import get_epg_service
from app.services.ersatztv.m3u_parser import parse_m3u_playlist
from app.services.ersatztv.refresh import run_feed_lookup
from app.services.ersatztv.xmltv_parser import guide as ersatztv_guide
from app.services.highlight import highlight_service
from app.services.logo_proxy import LOGO_CACHE, url_origin
from app.services.settings_store import SettingsDocument

log = logger.bind(service="config_apply")

DISPATCHARR_FIELDS = frozenset({"dispatcharr_url", "dispatcharr_api_key"})
PLEX_OWNER_FIELDS = frozenset({"plex_server_token", "plex_auth_enabled"})


def client_features() -> Features:
    """Chat and GIFs as they are now: what connection_ack and features_update carry."""
    key = settings.giphy_api_key
    return Features(chat=settings.chat_enabled, gif=bool(key and key.get_secret_value()))


def _feature_switches() -> tuple[bool, ...]:
    """Which optional features clients can use: chat, GIFs, clips, Zipline, casting, feedback."""
    features = client_features()
    return (
        features.chat,
        features.gif,
        settings.highlight_enabled,
        settings.zipline_available,
        settings.cast_enabled,
        settings.ntfy_available,
    )


async def broadcast_features_update() -> None:
    """Tell every connected client an optional feature switched on or off."""
    await channel_state.broadcast(
        ServerFeaturesUpdate(type="features_update", features=client_features())
    )


async def _prepare(values: Mapping[str, object]) -> None:
    """Sweep what a feature left behind before it is switched back on."""
    if values.get("highlight_enabled") is True and not settings.highlight_enabled:
        await asyncio.to_thread(highlight_service.cleanup_stale_segments)
    if values.get("cast_enabled") is True and not settings.cast_enabled:
        await asyncio.to_thread(cast_service.cleanup_stale_sessions)


def _invalidate(changed: set[str]) -> None:
    """Drop what the old values filled. Synchronous: it follows the assignments directly."""
    if changed & DISPATCHARR_FIELDS:
        dispatcharr.invalidate_catalogue()
        get_epg_service().reset()
        LOGO_CACHE.clear("dispatcharr:")
        log.info("Dispatcharr settings changed: its catalogue, guide and logos will reload")
    if "ersatztv_base_url" in changed:
        ersatztv_guide.reset()
        LOGO_CACHE.clear("ersatztv:")
        log.info("ErsatzTV address changed: its channels, guide and logos will reload")
    if changed & PLEX_OWNER_FIELDS:
        plex.clear_server_owner_id_cache()
        plex.start_server_owner_lookup()
    if "log_level" in changed:
        configure_logging()


async def _leave_address(old_url: str) -> None:
    """Move Live, recorders and casts off a source's old address."""
    old = url_origin(old_url)
    if old is None:
        return

    def on_old(url: str) -> bool:
        return url_origin(url) == old

    live = channel_state.get_current_channel()
    if live is not None and on_old(live.stream_url):
        await channel_state.reresolve_live()
    await highlight_service.stop_recorders(lambda recorder: on_old(recorder.stream_url))
    await cast_service.stop_sessions(lambda session: on_old(session.stream_url))


async def _side_effects(changed: set[str], before: Mapping[str, object]) -> None:
    if "ersatztv_base_url" in changed:
        # A feed thread can hold the M3U lock through a slow fetch, so the
        # reset waits for it off the event loop
        await run_feed_lookup(parse_m3u_playlist.reset)
        await _leave_address(str(before["ersatztv_base_url"]))
    if "dispatcharr_url" in changed:
        await _leave_address(str(before["dispatcharr_url"]))
    if "highlight_enabled" in changed and not settings.highlight_enabled:
        await highlight_service.stop_all()
    if "cast_enabled" in changed and not settings.cast_enabled:
        await cast_service.stop_sessions()


async def apply(
    values: Mapping[UiField, object],
    edit: Callable[[SettingsDocument], None] | None = None,
) -> set[str]:
    """Save values and make the running app use them.

    Args:
        values: The settings to change; each is checked as assigning it would.
        edit: Also changes the document under the store's lock, before it is
            written; raising there writes and applies nothing.

    Returns:
        The fields whose value changed. A field in a group the environment
        locks is saved but never changes.

    Raises:
        InvalidSettingError: A value its setting refuses; nothing is written.
        OSError: The file couldn't be written; nothing is applied.
    """
    validated = settings_store.validate_values(values)
    before = {field: getattr(settings, field) for field in validated}
    await _prepare(validated)
    async with settings_store.edit() as draft:
        # Under the store's lock: no other save lands between this and the check below
        switches = _feature_switches()
        draft.values.update(validated)
        if edit is not None:
            edit(draft)
    changed = {field for field in validated if getattr(settings, field) != before[field]}
    _invalidate(changed)
    if _feature_switches() != switches:
        await broadcast_features_update()
    await _side_effects(changed, before)
    return changed
