"""Hermetic test defaults: no developer dotenv, credentials, or external sockets."""

import ast
import os
import socket
from pathlib import Path
from unittest.mock import patch

import pytest
from pydantic_settings import DotEnvSettingsSource

# Prevent dotenv reads even during application module import. Parent environment
# is removed for every known setting before constructing the synthetic singleton.
config_source = Path(__file__).parents[1] / "app" / "config.py"
for node in ast.walk(ast.parse(config_source.read_text())):
    if isinstance(node, ast.ClassDef) and node.name == "Settings":
        for field_node in node.body:
            if isinstance(field_node, ast.AnnAssign) and isinstance(field_node.target, ast.Name):
                os.environ.pop(field_node.target.id.upper(), None)

with patch.object(DotEnvSettingsSource, "_read_env_files", return_value={}):
    from app.config import Settings, settings

    for field in Settings.model_fields:
        os.environ.pop(field.upper(), None)
    isolated = Settings(_env_file=None, jwt_secret="test-only-signing-key-with-at-least-32-bytes")
    for field in Settings.model_fields:
        setattr(settings, field, getattr(isolated, field))


@pytest.fixture(autouse=True)
def no_presence_broadcasts(monkeypatch):
    """Keep presence_update out of socket tests' receive order.

    Presence tests turn broadcasts back on by restoring the real function.
    """
    from app.services import presence_broadcast

    monkeypatch.setattr(presence_broadcast, "schedule_broadcast", lambda: None)


@pytest.fixture(autouse=True)
def reset_module_state(monkeypatch):
    """Start every test from empty module-level caches and registries.

    The app keeps its state in module singletons, so a test must not see what
    an earlier one left behind (the NHL cache made one test order-dependent).
    """
    from app.routers import csp_report
    from app.services import app_settings, channel_state, chat, nhl, plex, presence
    from app.services.highlight import highlight_service

    nhl.clear_nhl_cache()
    chat.clear_history()
    presence._active_users.clear()
    presence._stale_closes.clear()
    channel_state._failed_closes.clear()
    channel_state.clear_current_channel()
    plex.clear_server_owner_id_cache()
    highlight_service.clear_start_backoff()
    csp_report.clear_csp_report_state()
    monkeypatch.setattr(app_settings, "_user_channel_selection", False)
    monkeypatch.setattr(app_settings, "_presence_visible", False)
    channel_state.reset_live_change_state()
    __import__("app.services.cached_fetch", fromlist=["_"]).reset_all_caches()
    __import__("app.routers.epg", fromlist=["_"]).clear_unavailable_warning()
    __import__("app.services.ersatztv", fromlist=["_"]).reset_state()
    __import__("app.services.media_limits").services.media_limits.reset_media_budgets()
    __import__("app.services.gauges", fromlist=["_"]).reset_gauges_task()
    __import__("app.services.state_store", fromlist=["_"]).reset_state_store()
    __import__("app.services.stream_sessions", fromlist=["_"]).clear()


@pytest.fixture(autouse=True)
def hermetic_environment(monkeypatch):
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    monkeypatch.setattr(DotEnvSettingsSource, "_read_env_files", lambda self: {})
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_getaddrinfo = socket.getaddrinfo

    def check(address):
        if isinstance(address, tuple) and address[0] not in ("127.0.0.1", "::1", "localhost"):
            pytest.fail(f"Unexpected external socket to {address[0]!r}; install a mock transport")

    def connect(sock, address):
        check(address)
        return original_connect(sock, address)

    def connect_ex(sock, address):
        check(address)
        return original_connect_ex(sock, address)

    def getaddrinfo(host, *args, **kwargs):
        if host not in (None, "127.0.0.1", "::1", "localhost", b"localhost", b"127.0.0.1", b"::1"):
            pytest.fail(f"Unexpected external DNS for {host!r}; install a mock transport")
        return original_getaddrinfo(host, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)
    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
