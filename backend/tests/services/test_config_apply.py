"""Saved settings reach the running app without a restart: one test per kind of change."""

import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import config
from app.config import settings
from app.models.channel import Channel, GroupedChannelsResponse
from app.models.websocket import server_payload
from app.services import channel_state, config_apply, dispatcharr, plex, settings_store
from app.services.cached_fetch import CachedFetch
from app.services.cast import CastSession, cast_service
from app.services.epg_service import get_epg_service
from app.services.ersatztv.m3u_parser import _cache as m3u_cache
from app.services.ersatztv.m3u_parser import parse_m3u_playlist
from app.services.ersatztv.xmltv_parser import guide as ersatztv_guide
from app.services.highlight import ChannelRecorder, highlight_service
from app.services.logo_proxy import LOGO_CACHE
from app.services.media_limits import MediaCapacityError, export_budget
from app.services.media_source import MediaChannel
from app.services.xmltv_cache import GuideIndex, XmltvCache

OLD_DISPATCHARR = "http://dispatcharr.test:9191"
NEW_DISPATCHARR = "http://dispatcharr-new.test:9191"
ON_OLD = Channel(
    id="uuid-1", name="TSN", stream_url=f"{OLD_DISPATCHARR}/proxy/ts/stream/uuid-1", guide_id="7"
)


@pytest.fixture(autouse=True)
def saved_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A data directory, and nothing locked by the environment but the signing key."""
    monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret"}))
    monkeypatch.setattr(settings, "state_file", str(tmp_path / "state.json"))
    settings_store.start()
    return tmp_path / "settings.json"


class StoppedRecorder(ChannelRecorder):
    """A recorder with no FFmpeg that notes being stopped."""

    stopped = False

    async def stop(self) -> None:
        self.stopped = True


class StoppedSession(CastSession):
    stopped = False

    async def stop(self) -> None:
        self.stopped = True


class TestGenerationGuards:
    """A reset can't be undone by a fetch that started before it (any source)."""

    async def test_a_catalogue_fetch_overtaken_by_invalidate_is_not_kept(self) -> None:
        release = asyncio.Event()
        fetches = 0

        async def fetch() -> int:
            nonlocal fetches
            fetches += 1
            await release.wait()
            return fetches

        cache = CachedFetch("synthetic", fetch, ttl=60, error=RuntimeError)
        first = asyncio.create_task(cache.get())
        await asyncio.sleep(0)

        cache.invalidate()
        release.set()

        # The caller that asked still gets an answer, but the cache doesn't keep it
        assert await first == 1
        assert cache.peek() is None
        assert await cache.get() == 2

    async def test_a_failure_overtaken_by_invalidate_leaves_no_backoff(self) -> None:
        release = asyncio.Event()

        async def fetch() -> int:
            await release.wait()
            raise RuntimeError("old address")

        cache = CachedFetch("synthetic", fetch, ttl=60, error=RuntimeError)
        first = asyncio.create_task(cache.get())
        await asyncio.sleep(0)

        cache.invalidate()
        release.set()

        with pytest.raises(RuntimeError, match="old address"):
            await first
        assert cache._last_error is None and cache._retry_after == 0.0

    async def test_a_guide_refresh_overtaken_by_reset_stores_nothing(self) -> None:
        release = asyncio.Event()

        async def fetch() -> bytes:
            await release.wait()
            return b"old"

        guide = XmltvCache[str](
            name="synthetic guide",
            fetch=fetch,
            parse=lambda body: GuideIndex({"ch1": [body.decode()]}),
            ttl=timedelta(minutes=5),
            start=lambda programme: datetime.now(),
            end=lambda programme: datetime.now(),
            unavailable=lambda: RuntimeError("unavailable"),
            configured=lambda: True,
        )
        stale = asyncio.create_task(guide.ensure_fresh())
        await asyncio.sleep(0)

        guide.reset()
        release.set()
        await stale

        assert guide._cache == {}
        assert guide._consecutive_failures == 0 and guide._retry_at is None

    async def test_a_logo_fetched_before_a_clear_is_served_but_not_kept(self) -> None:
        release = asyncio.Event()

        async def fetch() -> tuple[bytes, str]:
            await release.wait()
            return b"old-logo", "image/png"

        first = asyncio.create_task(LOGO_CACHE.get("dispatcharr:5", fetch, not_found_ttl=60))
        await asyncio.sleep(0)

        LOGO_CACHE.clear("dispatcharr:")
        release.set()

        assert await first == (b"old-logo", "image/png")
        assert LOGO_CACHE.cached("dispatcharr:5") is None


class TestDispatcharrAddress:
    async def test_caches_reset_and_the_guide_follows_the_new_address(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "dispatcharr_url", OLD_DISPATCHARR)
        invalidate = MagicMock()
        monkeypatch.setattr(dispatcharr, "invalidate_catalogue", invalidate)
        LOGO_CACHE.store("dispatcharr:1", b"logo", "image/png")
        LOGO_CACHE.store("ersatztv:1", b"logo", "image/png")
        guide_reset = MagicMock()
        monkeypatch.setattr(get_epg_service(), "reset", guide_reset)

        changed = await config_apply.apply({"dispatcharr_url": NEW_DISPATCHARR})

        assert changed == {"dispatcharr_url"}
        invalidate.assert_called_once_with()
        guide_reset.assert_called_once_with()
        assert get_epg_service().dispatcharr_url == NEW_DISPATCHARR
        assert LOGO_CACHE.cached("dispatcharr:1") is None
        assert LOGO_CACHE.cached("ersatztv:1") is not None

    async def test_a_new_key_resets_the_catalogue_but_leaves_live_alone(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        invalidate = MagicMock()
        monkeypatch.setattr(dispatcharr, "invalidate_catalogue", invalidate)
        reresolve = AsyncMock()
        monkeypatch.setattr(channel_state, "reresolve_live", reresolve)
        await channel_state.set_current_channel(ON_OLD)

        await config_apply.apply({"dispatcharr_api_key": "synthetic-new-key"})

        invalidate.assert_called_once_with()
        reresolve.assert_not_awaited()

    async def test_live_is_resolved_again_from_the_new_catalogue(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "dispatcharr_url", OLD_DISPATCHARR)
        await channel_state.set_current_channel(ON_OLD)
        moved = ON_OLD.model_copy(
            update={"stream_url": f"{NEW_DISPATCHARR}/proxy/ts/stream/uuid-1"}
        )
        broadcast = AsyncMock()
        monkeypatch.setattr(channel_state, "broadcast", broadcast)

        with patch(
            "app.services.media_source.resolve_media_channel",
            AsyncMock(return_value=MediaChannel(moved, "mpegts")),
        ):
            await config_apply.apply({"dispatcharr_url": NEW_DISPATCHARR})
            assert channel_state._restore_task is not None
            await channel_state._restore_task

        assert channel_state.get_current_channel() == moved
        sent = [server_payload(call.args[0]) for call in broadcast.await_args_list]
        assert [message["channel"] for message in sent][0] is None
        assert sent[-1]["channel"]["streamUrl"] == moved.stream_url

    async def test_recorders_and_casts_on_the_old_address_stop(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "dispatcharr_url", OLD_DISPATCHARR)
        old_recorder = StoppedRecorder("uuid-1", ON_OLD.stream_url)
        other_recorder = StoppedRecorder("ets-1", "http://ersatztv.test:8409/iptv/channel/1.m3u8")
        highlight_service._recorders.update({"uuid-1": old_recorder, "ets-1": other_recorder})
        old_cast = StoppedSession("s-old", "uuid-1", ON_OLD.stream_url, "mpegts")
        other_cast = StoppedSession("s-other", "ets-1", other_recorder.stream_url, "hls")
        cast_service._sessions.update({"s-old": old_cast, "s-other": other_cast})

        try:
            await config_apply.apply({"dispatcharr_url": NEW_DISPATCHARR})

            assert old_recorder.stopped and not other_recorder.stopped
            assert list(highlight_service._recorders) == ["ets-1"]
            assert old_cast.stopped and not other_cast.stopped
            assert list(cast_service._sessions) == ["s-other"]
        finally:
            highlight_service._recorders.clear()
            cast_service._sessions.clear()


class TestErsatzTVAddress:
    async def test_the_feed_guide_and_logos_reset(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "ersatztv_base_url", "http://ersatztv.test:8409")
        m3u_cache.update(channels=["stale"], timestamp=None, last_successful_fetch=object())
        guide_reset = MagicMock()
        monkeypatch.setattr(ersatztv_guide, "reset", guide_reset)
        LOGO_CACHE.store("ersatztv:1", b"logo", "image/png")

        await config_apply.apply({"ersatztv_base_url": "http://ersatztv-new.test:8409"})

        assert m3u_cache["channels"] == [] and m3u_cache["last_successful_fetch"] is None
        guide_reset.assert_called_once_with()
        assert LOGO_CACHE.cached("ersatztv:1") is None

    async def test_the_feed_reset_does_not_block_the_event_loop(self) -> None:
        """A feed thread can hold the M3U lock through a 15 s fetch."""
        parse_m3u_playlist._lock.acquire()
        try:
            applying = asyncio.create_task(
                config_apply.apply({"ersatztv_base_url": "http://ersatztv-new.test:8409"})
            )
            # The loop keeps running while the reset waits on the lock
            for _ in range(5):
                await asyncio.sleep(0.01)
            assert not applying.done()
        finally:
            parse_m3u_playlist._lock.release()
        assert await applying == {"ersatztv_base_url"}

    def test_logos_are_matched_by_origin_not_by_string(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.models.ersatztv import EPGChannel
        from app.services.ersatztv import epg_service

        monkeypatch.setattr(settings, "ersatztv_base_url", "HTTP://ErsatzTV.test:80/")
        channel = EPGChannel(
            id="1",
            name="One",
            stream_url="http://ersatztv.test/iptv/channel/1.m3u8",
            logo_url="http://ersatztv.test/iptv/logos/1.png",
        )
        monkeypatch.setattr(epg_service, "parse_m3u_playlist", lambda: [channel])

        (served,) = epg_service.get_channels()

        assert served.logo_url == "/api/ersatztv/logos/1"


class TestSwitches:
    async def test_clips_on_sweeps_old_segments_before_the_switch_flips(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: list[bool] = []
        monkeypatch.setattr(
            highlight_service,
            "cleanup_stale_segments",
            lambda: seen.append(settings.highlight_enabled),
        )

        await config_apply.apply({"highlight_enabled": True})

        assert seen == [False]
        assert settings.highlight_enabled is True

    async def test_clips_off_stops_every_recorder(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "highlight_enabled", True)
        stop_all = AsyncMock()
        monkeypatch.setattr(highlight_service, "stop_all", stop_all)

        await config_apply.apply({"highlight_enabled": False})

        stop_all.assert_awaited_once_with()

    async def test_a_new_plex_token_looks_the_owner_up_again(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "plex_auth_enabled", True)
        plex._server_owner_id_cache["owner_id"] = "old-owner"
        lookup = MagicMock()
        monkeypatch.setattr(plex, "start_server_owner_lookup", lookup)

        await config_apply.apply({"plex_server_token": "synthetic-new-token"})

        assert plex._server_owner_id_cache == {}
        lookup.assert_called_once_with()

    async def test_a_new_log_level_reconfigures_logging(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure = MagicMock()
        monkeypatch.setattr(config_apply, "configure_logging", configure)

        await config_apply.apply({"log_level": "debug"})

        assert settings.log_level == "DEBUG"
        configure.assert_called_once_with()


def _features_updates(broadcast: AsyncMock) -> list[dict]:
    """The features_update messages handed to a stand-in channel_state.broadcast."""
    sent = [server_payload(call.args[0]) for call in broadcast.await_args_list]
    return [message for message in sent if message["type"] == "features_update"]


class TestFeaturesUpdate:
    """Open tabs hear when an optional feature switches on or off, and only then."""

    @pytest.fixture
    def broadcast(self, monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
        broadcast = AsyncMock()
        monkeypatch.setattr(channel_state, "broadcast", broadcast)
        # Switching clips on has nothing to sweep here
        monkeypatch.setattr(highlight_service, "cleanup_stale_segments", lambda: None)
        return broadcast

    @pytest.mark.parametrize(
        ("change", "features"),
        [
            ({"chat_enabled": True}, {"chat": True, "gif": False}),
            ({"giphy_api_key": "a giphy key"}, {"chat": False, "gif": True}),
            ({"highlight_enabled": True}, {"chat": False, "gif": False}),
            (
                {"ntfy_enabled": True, "ntfy_url": "https://ntfy.test", "ntfy_topic": "reports"},
                {"chat": False, "gif": False},
            ),
        ],
        ids=["chat", "gifs", "clips", "feedback"],
    )
    async def test_a_feature_switching_tells_every_tab_once(
        self, broadcast: AsyncMock, change: dict, features: dict
    ) -> None:
        await config_apply.apply(change)

        assert _features_updates(broadcast) == [{"type": "features_update", "features": features}]

    async def test_zipline_uploads_starting_tell_every_tab(
        self, broadcast: AsyncMock, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "highlight_enabled", True)

        await config_apply.apply(
            {"zipline_enabled": True, "zipline_url": "https://zipline.test", "zipline_token": "t 1"}
        )

        assert len(_features_updates(broadcast)) == 1

    async def test_a_feature_switching_off_tells_every_tab(
        self, broadcast: AsyncMock, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "chat_enabled", True)

        await config_apply.apply({"chat_enabled": False})

        assert _features_updates(broadcast) == [
            {"type": "features_update", "features": {"chat": False, "gif": False}}
        ]

    @pytest.mark.parametrize(
        "change",
        [
            {"log_level": "DEBUG"},
            # Feedback still has no address or topic
            {"ntfy_enabled": True},
            # GIFs were on and stay on
            {"giphy_api_key": "another giphy key"},
        ],
        ids=["no feature", "still unavailable", "still on"],
    )
    async def test_a_save_that_switches_nothing_tells_nobody(
        self, broadcast: AsyncMock, monkeypatch: pytest.MonkeyPatch, change: dict
    ) -> None:
        monkeypatch.setattr(settings, "giphy_api_key", SecretStr("a giphy key"))

        await config_apply.apply(change)

        assert _features_updates(broadcast) == []

    async def test_a_feature_the_environment_locks_tells_nobody(
        self, broadcast: AsyncMock, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret", "chat_enabled"}))

        await config_apply.apply({"chat_enabled": True})

        assert _features_updates(broadcast) == []


class TestReadLive:
    def test_the_request_cap_follows_the_setting(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.main import app

        client = TestClient(app)
        body = {"userChannelSelection": True, "padding": "x" * 2000}
        assert client.put("/api/settings", json=body).status_code != 413

        monkeypatch.setattr(settings, "request_body_max_bytes", 1024)

        assert client.put("/api/settings", json=body).status_code == 413

    async def test_a_running_recorder_keeps_its_ring_and_the_next_one_takes_the_new_values(
        self,
    ) -> None:
        running = ChannelRecorder("uuid-1", ON_OLD.stream_url)

        await config_apply.apply({"highlight_buffer_seconds": 30, "highlight_segment_seconds": 5})

        assert (running.buffer_seconds, running.segment_seconds) == (60, 10)
        following = ChannelRecorder("uuid-1", ON_OLD.stream_url)
        assert (following.buffer_seconds, following.segment_seconds) == (30, 5)

    async def test_media_limits_apply_to_the_next_request(self) -> None:
        await config_apply.apply({"media_export_limit": 1, "media_export_per_user": 1})

        export_budget.acquire("someone")
        with pytest.raises(MediaCapacityError):
            export_budget.acquire("someone-else")
        export_budget.release("someone")


class TestBatch:
    async def test_an_invalid_value_applies_nothing(self, saved_settings: Path) -> None:
        with pytest.raises(settings_store.InvalidSettingError):
            await config_apply.apply({"chat_enabled": True, "media_export_limit": "many"})

        assert settings.chat_enabled is False
        assert not saved_settings.exists()

    async def test_a_locked_group_is_saved_but_never_changes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret", "chat_enabled"}))

        changed = await config_apply.apply({"chat_enabled": True})

        assert changed == set()
        assert settings.chat_enabled is False


@pytest.fixture(autouse=True)
def no_catalogue(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep restores and catalogue lookups off the network."""
    monkeypatch.setattr(
        dispatcharr, "get_grouped_channels", AsyncMock(return_value=GroupedChannelsResponse())
    )
