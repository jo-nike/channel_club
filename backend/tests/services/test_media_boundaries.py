"""Regression tests for media authority and filesystem boundaries."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.models.auth import TokenPayload
from app.models.channel import GroupedChannelsResponse, SetChannelRequest
from app.routers.auth_deps import get_current_user
from app.routers.highlight import router
from app.services.highlight import ChannelRecorder, remove_recording_directory


@pytest.fixture(autouse=True)
def empty_grouped_catalog():
    from app.models.channel import GroupedChannelsResponse

    with patch(
        "app.services.media_source.get_grouped_channels",
        AsyncMock(return_value=GroupedChannelsResponse()),
    ):
        yield


@pytest.mark.asyncio
@pytest.mark.parametrize("ungrouped", [False, True])
async def test_picker_catalog_resolves_without_hdhr_or_ersatz(ungrouped):
    from app.models.channel import Channel, ChannelGroupWithChannels, GroupedChannelsResponse
    from app.services.media_source import resolve_media_channel

    channel = Channel(id="picker", name="Trusted", streamUrl="https://source/ts", guideId="194")
    catalog = GroupedChannelsResponse(
        groups=[]
        if ungrouped
        else [ChannelGroupWithChannels(id=1, name="Canada", channelCount=1, channels=[channel])],
        ungrouped=[channel] if ungrouped else [],
    )
    with (
        patch("app.services.media_source.get_grouped_channels", AsyncMock(return_value=catalog)),
        patch(
            "app.services.media_source.get_channel_by_id", side_effect=RuntimeError("offline")
        ) as ersatz,
    ):
        source = await resolve_media_channel(channel.id)
        assert source.channel == channel
        assert source.stream_type == "mpegts"
        ersatz.assert_not_called()


@pytest.mark.asyncio
async def test_grouped_outage_is_unavailable_not_unknown():
    from fastapi import HTTPException

    from app.services.media_source import resolve_media_channel

    with (
        patch(
            "app.services.media_source.get_grouped_channels", AsyncMock(side_effect=RuntimeError)
        ),
        patch("app.services.media_source.get_channel_by_id", return_value=None),
    ):
        with pytest.raises(HTTPException) as exc:
            await resolve_media_channel("dispatch")
        assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_ersatz_id_resolves_fast_without_hdhr_while_dispatcharr_times_out(monkeypatch):
    import httpx

    from app.models.channel import Channel
    from app.services import dispatcharr
    from app.services.http_clients import DISPATCHARR
    from app.services.media_source import resolve_media_channel
    from tests.http_helpers import mock_upstream

    monkeypatch.setattr(settings, "dispatcharr_url", "http://dispatcharr.test")
    monkeypatch.setattr(settings, "dispatcharr_api_key", "test-key")
    paths: list[str] = []

    def timeout(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        raise httpx.ConnectTimeout("timed out", request=request)

    mock_upstream(DISPATCHARR, timeout)
    channel = Channel(
        id="ersatz", name="healthy", streamUrl="http://catalog.invalid/hls", guideId="1"
    )
    with (
        patch("app.services.media_source.get_grouped_channels", dispatcharr.get_grouped_channels),
        patch("app.services.media_source.get_channel_by_id", return_value=channel),
    ):
        async with asyncio.timeout(1):
            source = await resolve_media_channel("ersatz")
    assert source.stream_type == "hls"
    assert paths  # the grouped catalogue was tried
    assert "/hdhr/lineup.json" not in paths


@pytest.mark.parametrize("identifier", ["", " ", ".", "..", "/tmp/victim", "a/../b", "a\\b"])
def test_channel_json_rejects_paths(identifier):
    with pytest.raises(ValueError):
        SetChannelRequest(id=identifier, name="test", streamUrl="http://unused", guideId="test")


@pytest.mark.parametrize(
    ("method", "route"),
    [
        ("GET", "/api/highlight/status/{}"),
        ("POST", "/api/highlight/{}/capture"),
    ],
)
@pytest.mark.parametrize(
    "identifier", ["%2e", "%2e%2e", "%20", "a%00b", pytest.param("x" * 300, id="300-chars")]
)
def test_actual_highlight_routes_reject_invalid_ids(method, route, identifier, monkeypatch):
    monkeypatch.setattr(settings, "highlight_enabled", True)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(
        sub="test", role="viewer", exp=datetime(2099, 1, 1, tzinfo=UTC)
    )
    with TestClient(app) as client, patch("subprocess.Popen") as spawn:
        assert client.request(method, route.format(identifier)).status_code == 422
        spawn.assert_not_called()


@pytest.mark.asyncio
async def test_malicious_recorder_cleanup_preserves_sibling(tmp_path, monkeypatch):
    root = tmp_path / "recordings"
    root.mkdir()
    sentinel = tmp_path / "sentinel"
    sentinel.write_text("keep")
    monkeypatch.setattr(settings, "highlight_temp_dir", str(root))
    for directory in [root, root / "..", tmp_path]:
        recorder = ChannelRecorder("safe", "http://unused")
        recorder.segment_dir = directory
        await recorder.stop()
        assert sentinel.read_text() == "keep"
    link = root / "link"
    link.symlink_to(tmp_path, target_is_directory=True)
    remove_recording_directory(link)
    assert sentinel.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("startup", ["success", "dead", "cancel", "missing"])
async def test_startup_lifecycle_uses_opaque_directory_and_cleans(tmp_path, monkeypatch, startup):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    recorder = ChannelRecorder("normal-id", "http://unused")
    process = MagicMock()
    process.poll.return_value = 0 if startup == "dead" else None
    sleep = AsyncMock(side_effect=asyncio.CancelledError if startup == "cancel" else None)
    with (
        patch(
            "subprocess.Popen",
            side_effect=FileNotFoundError if startup == "missing" else None,
            return_value=process,
        ),
        patch("asyncio.sleep", sleep),
        patch("os.killpg"),
        patch("os.getpgid"),
    ):
        if startup == "cancel":
            with pytest.raises(asyncio.CancelledError):
                await recorder.start()
        else:
            assert await recorder.start() is (startup == "success")
        if startup == "success":
            assert recorder.segment_dir is not None
            assert recorder.segment_dir.name.startswith("recorder-")
            process.poll.return_value = 1
            await recorder.stop()
    assert not list(tmp_path.iterdir())


@pytest.mark.asyncio
@pytest.mark.parametrize("identifier", ["", " ", "unknown"])
async def test_unresolved_source_never_spawns(identifier, monkeypatch):
    from fastapi import HTTPException

    from app.services.highlight import HighlightService

    monkeypatch.setattr(settings, "highlight_enabled", True)
    with (
        patch("app.services.media_source.get_channel_by_id", return_value=None),
        patch("subprocess.Popen") as spawn,
    ):
        with pytest.raises(HTTPException):
            await HighlightService().start_recording(
                identifier, "http://off-catalog.invalid/private"
            )
        spawn.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["dispatcharr", "ersatz"])
async def test_resolved_source_replaces_client_url(provider, monkeypatch):
    from app.models.channel import Channel
    from app.services.highlight import HighlightService

    channel = Channel(
        id="valid", name="catalog", streamUrl="http://catalog.invalid/source", guideId="v"
    )
    monkeypatch.setattr(settings, "highlight_enabled", True)
    with (
        patch(
            "app.services.media_source.get_channel_by_id",
            return_value=channel if provider == "ersatz" else None,
        ),
        patch(
            "app.services.media_source.get_grouped_channels",
            AsyncMock(
                return_value=GroupedChannelsResponse(
                    ungrouped=[channel] if provider == "dispatcharr" else []
                )
            ),
        ),
        patch.object(ChannelRecorder, "start", AsyncMock(return_value=True)),
    ):
        service = HighlightService()
        assert await service.start_recording("valid", "http://off-catalog.invalid/private")
        assert service._recorders["valid"].stream_url == channel.stream_url
        await service.stop_all()


@pytest.mark.asyncio
async def test_dispatcharr_media_does_not_depend_on_ersatz(monkeypatch):
    from app.models.channel import Channel
    from app.services.media_source import resolve_media_channel

    channel = Channel(
        id="dispatch", name="healthy", streamUrl="http://catalog.invalid/ts", guideId="1"
    )
    with (
        patch(
            "app.services.media_source.get_grouped_channels",
            AsyncMock(return_value=GroupedChannelsResponse(ungrouped=[channel])),
        ),
        patch(
            "app.services.media_source.get_channel_by_id", side_effect=RuntimeError("offline")
        ) as optional,
    ):
        source = await resolve_media_channel("dispatch")
        assert source.stream_type == "mpegts"
        assert source.channel == channel
        optional.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("outage,expected", [(False, 404), (True, 503)])
async def test_unknown_and_unavailable_have_distinct_status(outage, expected):
    from fastapi import HTTPException

    from app.services.media_source import resolve_media_channel

    with (
        patch(
            "app.services.media_source.get_channel_by_id",
            return_value=None,
            side_effect=RuntimeError("offline") if outage else None,
        ),
    ):
        with pytest.raises(HTTPException) as exc:
            await resolve_media_channel("unknown")
        assert exc.value.status_code == expected


@pytest.mark.asyncio
async def test_ersatz_works_when_dispatcharr_unavailable():
    from app.models.channel import Channel
    from app.services.media_source import resolve_media_channel

    channel = Channel(
        id="ersatz", name="healthy", streamUrl="http://catalog.invalid/hls", guideId="1"
    )
    with (
        patch(
            "app.services.media_source.get_grouped_channels",
            AsyncMock(side_effect=RuntimeError("offline")),
        ),
        patch("app.services.media_source.get_channel_by_id", return_value=channel),
    ):
        source = await resolve_media_channel("ersatz")
        assert source.stream_type == "hls"
