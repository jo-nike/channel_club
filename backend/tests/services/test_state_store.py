"""The state file keeps admin settings and Live across a restart (F-06)."""

import asyncio
import json
import time
from pathlib import Path
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from loguru import logger

from app import main
from app.config import settings
from app.models.channel import Channel
from app.services import app_settings, channel_state, chat, state_store
from app.services.media_source import MediaChannel

if TYPE_CHECKING:
    from loguru import Record

CHANNEL = Channel(
    id="uuid-1",
    name="TSN",
    stream_url="https://streams.example.com/proxy/ts/stream/uuid-1",
    guide_id="7",
)


@pytest.fixture
def state_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "state.json"
    monkeypatch.setattr(settings, "state_file", str(path))
    return path


@pytest.fixture
def records():
    captured: list[Record] = []
    handler_id = logger.add(lambda message: captured.append(message.record), level="DEBUG")
    yield captured
    logger.remove(handler_id)


def write_state(path: Path, **changes: object) -> None:
    path.write_text(json.dumps({**state_store.DEFAULTS, **changes}))


def warnings(records: list["Record"]) -> list[str]:
    return [r["message"] for r in records if r["level"].name == "WARNING"]


class TestLoadAndSave:
    @pytest.mark.asyncio
    async def test_round_trip(self, state_file: Path) -> None:
        await state_store.save({"presenceVisible": True, "liveChannelId": "uuid-1"})
        await state_store.save({"liveSetBy": "jon"})

        state_store.reset_state_store()
        loaded = state_store.load()

        assert loaded == {
            "version": 1,
            "userChannelSelection": False,
            "presenceVisible": True,
            "liveChannelId": "uuid-1",
            "liveSetBy": "jon",
        }
        # No temp files are left beside it
        assert [p.name for p in state_file.parent.iterdir()] == ["state.json"]

    @pytest.mark.parametrize(
        "content",
        [
            "{not json",
            json.dumps({**state_store.DEFAULTS, "version": 0}),
            json.dumps({**state_store.DEFAULTS, "presenceVisible": "yes"}),
            json.dumps([1, 2]),
        ],
    )
    def test_corrupt_or_old_file_gives_defaults_and_one_warning(
        self, state_file: Path, records: list["Record"], content: str
    ) -> None:
        state_file.write_text(content)

        assert state_store.load() == state_store.DEFAULTS
        assert len(warnings(records)) == 1

    def test_missing_file_gives_defaults_and_one_warning(
        self, state_file: Path, records: list["Record"]
    ) -> None:
        assert state_store.load() == state_store.DEFAULTS
        assert len(warnings(records)) == 1

    @pytest.mark.asyncio
    async def test_disabled_reads_and_writes_nothing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, records: list["Record"]
    ) -> None:
        monkeypatch.chdir(tmp_path)
        assert settings.state_file == ""

        assert state_store.load() == state_store.DEFAULTS
        await state_store.save({"presenceVisible": True})

        assert list(tmp_path.iterdir()) == []
        assert warnings(records) == []

    @pytest.mark.asyncio
    async def test_unwritable_path_warns_and_carries_on(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, records: list["Record"]
    ) -> None:
        monkeypatch.setattr(settings, "state_file", str(tmp_path / "missing-dir" / "state.json"))

        await state_store.save({"presenceVisible": True})

        assert len(warnings(records)) == 1
        assert state_store.current()["presenceVisible"] is True


class TestSettersPersist:
    @pytest.mark.asyncio
    async def test_app_settings_setters_save(self, state_file: Path) -> None:
        await app_settings.set_user_channel_selection(True, user="admin")
        await app_settings.set_presence_visible(True, user="admin")

        saved = json.loads(state_file.read_text())
        assert saved["userChannelSelection"] is True
        assert saved["presenceVisible"] is True

    def test_restore_app_settings_applies_the_loaded_values(self, state_file: Path) -> None:
        write_state(state_file, userChannelSelection=True, presenceVisible=True)

        app_settings.restore_app_settings(state_store.load())

        assert app_settings.user_channel_selection_enabled() is True
        assert app_settings.presence_visible_enabled() is True

    @pytest.mark.asyncio
    async def test_live_set_and_clear_save_only_the_id(self, state_file: Path) -> None:
        await channel_state.set_current_channel(CHANNEL, user="jon")

        saved = json.loads(state_file.read_text())
        assert saved["liveChannelId"] == "uuid-1"
        assert saved["liveSetBy"] == "jon"
        # Never the Channel blob: it carries a stream URL
        assert "streams.example.com" not in state_file.read_text()

        await channel_state.clear_current_channel_async(user="jon")

        saved = json.loads(state_file.read_text())
        assert saved["liveChannelId"] is None
        assert saved["liveSetBy"] is None


class TestRestoreLive:
    @pytest.mark.asyncio
    async def test_restore_is_quiet(
        self, state_file: Path, records: list["Record"], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "chat_enabled", True)
        write_state(state_file, liveChannelId="uuid-1", liveSetBy="jon")
        state = state_store.load()
        broadcast = AsyncMock()
        resolve = AsyncMock(return_value=MediaChannel(CHANNEL, "mpegts"))

        with (
            patch.object(channel_state, "broadcast", broadcast),
            patch("app.services.media_source.resolve_media_channel", resolve),
            patch.object(chat, "system_message") as system_message,
        ):
            channel_state.start_restore_task(state["liveChannelId"])
            assert channel_state._restore_task is not None
            await channel_state._restore_task

        assert channel_state.get_current_channel() == CHANNEL
        resolve.assert_awaited_once_with("uuid-1")
        # Clients get the ordinary channel_update, with no chat line and no name
        assert [call.args[0]["type"] for call in broadcast.await_args_list] == ["channel_update"]
        assert broadcast.await_args_list[0].args[0]["changedBy"] is None
        system_message.assert_not_called()
        assert not [r for r in records if r["extra"].get("event") == "channel.change"]

    @pytest.mark.asyncio
    async def test_stale_id_leaves_live_empty_and_clears_the_file(self, state_file: Path) -> None:
        write_state(state_file, liveChannelId="gone", liveSetBy="jon")
        state = state_store.load()
        resolve = AsyncMock(side_effect=HTTPException(404, "Channel not found"))

        with patch("app.services.media_source.resolve_media_channel", resolve):
            channel_state.start_restore_task(state["liveChannelId"])
            assert channel_state._restore_task is not None
            await channel_state._restore_task

        assert channel_state.get_current_channel() is None
        saved = json.loads(state_file.read_text())
        assert saved["liveChannelId"] is None
        assert saved["liveSetBy"] is None

    @pytest.mark.asyncio
    async def test_gives_up_quietly_while_the_catalogue_is_down(
        self, state_file: Path, records: list["Record"], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(channel_state, "RESTORE_RETRY_SECONDS", 0)
        monkeypatch.setattr(channel_state, "RESTORE_ATTEMPTS", 3)
        write_state(state_file, liveChannelId="uuid-1")
        state = state_store.load()
        resolve = AsyncMock(side_effect=HTTPException(503, "Channel catalog unavailable"))

        with patch("app.services.media_source.resolve_media_channel", resolve):
            channel_state.start_restore_task(state["liveChannelId"])
            assert channel_state._restore_task is not None
            await channel_state._restore_task

        assert resolve.await_count == 3
        assert channel_state.get_current_channel() is None
        # The id stays saved for the next start
        assert json.loads(state_file.read_text())["liveChannelId"] == "uuid-1"
        assert warnings(records) == []
        assert any("not restored" in r["message"] for r in records if r["level"].name == "INFO")

    @pytest.mark.asyncio
    async def test_a_live_change_during_restore_wins(self, state_file: Path) -> None:
        write_state(state_file, liveChannelId="uuid-1")
        state = state_store.load()
        release = asyncio.Event()
        other = CHANNEL.model_copy(update={"id": "uuid-2", "name": "CBC"})

        async def slow_resolve(channel_id: str) -> MediaChannel:
            await release.wait()
            return MediaChannel(CHANNEL, "mpegts")

        with patch("app.services.media_source.resolve_media_channel", slow_resolve):
            channel_state.start_restore_task(state["liveChannelId"])
            await channel_state.set_current_channel(other, user="jon")
            await channel_state.clear_current_channel_async(user="jon")
            release.set()
            assert channel_state._restore_task is not None
            await channel_state._restore_task

        assert channel_state.get_current_channel() is None


def test_startup_waits_briefly_so_the_first_clients_see_the_restored_live(
    state_file: Path,
) -> None:
    write_state(state_file, liveChannelId="uuid-1")

    async def slow_resolve(channel_id: str) -> MediaChannel:
        await asyncio.sleep(0.3)
        return MediaChannel(CHANNEL, "mpegts")

    with (
        patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
        patch("app.services.media_source.resolve_media_channel", slow_resolve),
        patch.object(channel_state, "_schedule_reconcile"),
        TestClient(main.app),
    ):
        assert channel_state.get_current_channel() == CHANNEL


def test_restore_does_not_block_startup_when_the_catalogue_hangs(
    state_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write_state(state_file, userChannelSelection=True, liveChannelId="uuid-1")
    monkeypatch.setattr(channel_state, "RESTORE_STARTUP_WAIT_SECONDS", 0.2)

    async def hang(channel_id: str) -> MediaChannel:
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    with (
        patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
        patch("app.services.media_source.resolve_media_channel", hang),
    ):
        started = time.monotonic()
        with TestClient(main.app) as client:
            assert client.get("/api/health").status_code == 200
            assert app_settings.user_channel_selection_enabled() is True
            assert channel_state.get_current_channel() is None
            task = channel_state._restore_task
            assert task is not None and not task.done()
        # Shutdown cancels the restore task rather than waiting on it
        assert task.cancelled()
        assert time.monotonic() - started < 5
