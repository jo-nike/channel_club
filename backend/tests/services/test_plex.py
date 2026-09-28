"""Tests for Plex authentication service."""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.models.plex import PlexUser
from app.services.plex import (
    InvalidPlexTokenError,
    check_server_access,
    validate_plex_token,
)


class TestValidatePlexToken:
    """Tests for validate_plex_token function."""

    @pytest.mark.asyncio
    async def test_valid_token_returns_plex_user(self) -> None:
        """Valid Plex token returns PlexUser with user data."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": 12345,
            "username": "testuser",
            "email": "test@example.com",
            "thumb": "https://plex.tv/users/avatar.png",
        }

        with patch("app.services.plex.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            user = await validate_plex_token("valid-token")

            assert isinstance(user, PlexUser)
            assert user.id == "12345"
            assert user.username == "testuser"
            assert user.email == "test@example.com"
            assert user.thumb == "https://plex.tv/users/avatar.png"

    @pytest.mark.asyncio
    async def test_invalid_token_raises_error(self) -> None:
        """Invalid Plex token raises InvalidPlexTokenError."""
        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch("app.services.plex.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            with pytest.raises(InvalidPlexTokenError):
                await validate_plex_token("invalid-token")

    @pytest.mark.asyncio
    async def test_calls_plex_api_with_correct_headers(self) -> None:
        """validate_plex_token calls Plex API with correct headers."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": 12345,
            "username": "testuser",
            "email": "test@example.com",
        }

        with patch("app.services.plex.httpx.AsyncClient") as mock_client:
            mock_get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value.get = mock_get

            await validate_plex_token("test-token")

            mock_get.assert_called_once()
            call_args = mock_get.call_args
            assert call_args[0][0] == "https://plex.tv/api/v2/user"
            assert "X-Plex-Token" in call_args[1]["headers"]
            assert call_args[1]["headers"]["X-Plex-Token"] == "test-token"
            assert call_args[1]["headers"]["Accept"] == "application/json"


class TestCheckServerAccess:
    """Tests for check_server_access function."""

    @pytest.mark.asyncio
    async def test_returns_true_when_no_server_configured(self) -> None:
        """Returns True when plex_server_machine_id is not configured."""
        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_machine_id = None

            result = await check_server_access("any-token")

            assert result is True

    @pytest.mark.asyncio
    async def test_returns_true_when_user_has_server_access(self) -> None:
        """Returns True when user has access to configured server."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {"clientIdentifier": "other-server-123"},
            {"clientIdentifier": "my-server-abc"},
        ]

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_machine_id = "my-server-abc"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=mock_response
                )

                result = await check_server_access("valid-token")

                assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_user_lacks_server_access(self) -> None:
        """Returns False when user doesn't have access to configured server."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {"clientIdentifier": "other-server-123"},
            {"clientIdentifier": "another-server-456"},
        ]

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_machine_id = "my-server-abc"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=mock_response
                )

                result = await check_server_access("valid-token")

                assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_api_request_fails(self) -> None:
        """Returns False when Plex API request fails."""
        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_machine_id = "my-server-abc"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=mock_response
                )

                result = await check_server_access("invalid-token")

                assert result is False

    @pytest.mark.asyncio
    async def test_calls_resources_api_with_correct_params(self) -> None:
        """check_server_access calls resources API with correct parameters."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_machine_id = "my-server-abc"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_get = AsyncMock(return_value=mock_response)
                mock_client.return_value.__aenter__.return_value.get = mock_get

                await check_server_access("test-token")

                mock_get.assert_called_once()
                call_args = mock_get.call_args
                assert call_args[0][0] == "https://plex.tv/api/v2/resources"
                assert call_args[1]["params"]["includeHttps"] == 1


class TestGetServerOwnerId:
    """Tests for get_server_owner_id function."""

    @pytest.mark.asyncio
    async def test_returns_none_when_no_server_token(self) -> None:
        """Returns None when plex_server_token is not configured."""
        from app.services.plex import clear_server_owner_id_cache, get_server_owner_id

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_token = None

            # Clear cache before test
            clear_server_owner_id_cache()
            result = await get_server_owner_id()

            assert result is None

    @pytest.mark.asyncio
    async def test_returns_owner_id_from_api(self) -> None:
        """Returns server owner ID from Plex API."""
        from app.services.plex import clear_server_owner_id_cache, get_server_owner_id

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": 98765,
            "username": "serverowner",
            "email": "owner@example.com",
        }

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_token = "server-token-123"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=mock_response
                )

                # Clear cache before test
                clear_server_owner_id_cache()
                result = await get_server_owner_id()

                assert result == "98765"

    @pytest.mark.asyncio
    async def test_returns_none_on_api_failure(self) -> None:
        """Returns None when Plex API request fails."""
        from app.services.plex import clear_server_owner_id_cache, get_server_owner_id

        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_token = "invalid-token"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=mock_response
                )

                # Clear cache before test
                clear_server_owner_id_cache()
                result = await get_server_owner_id()

                assert result is None

    @pytest.mark.asyncio
    async def test_caches_result(self) -> None:
        """Caches the server owner ID after first call."""
        from app.services.plex import clear_server_owner_id_cache, get_server_owner_id

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": 98765,
            "username": "serverowner",
            "email": "owner@example.com",
        }

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_token = "server-token-123"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_get = AsyncMock(return_value=mock_response)
                mock_client.return_value.__aenter__.return_value.get = mock_get

                # Clear cache before test
                clear_server_owner_id_cache()

                # Call twice
                await get_server_owner_id()
                await get_server_owner_id()

                # Should only call API once due to caching
                assert mock_get.call_count == 1


class TestServerOwnerLookup:
    """The owner id lookup behind require_admin's owner clause (A-02)."""

    @pytest.fixture(autouse=True)
    def owner_config(self, monkeypatch: pytest.MonkeyPatch):
        from app.services import plex

        monkeypatch.setattr(plex.settings, "plex_auth_enabled", True)
        monkeypatch.setattr(plex.settings, "plex_server_token", "synthetic-server-token")
        plex.clear_server_owner_id_cache()
        yield
        plex.clear_server_owner_id_cache()

    @staticmethod
    def _install_plex_tv(monkeypatch: pytest.MonkeyPatch, respond) -> list[dict[str, Any]]:
        """Route plex.tv to an async fake; returns the AsyncClient kwargs per call."""
        from app.services import plex

        clients: list[dict[str, Any]] = []
        factory = httpx.AsyncClient

        def client(**kwargs: Any) -> httpx.AsyncClient:
            clients.append(kwargs)
            return factory(transport=httpx.MockTransport(respond), **kwargs)

        monkeypatch.setattr(plex.httpx, "AsyncClient", client)
        return clients

    async def test_concurrent_misses_make_one_upstream_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        async def slow_owner(request: httpx.Request) -> httpx.Response:
            await asyncio.sleep(0.01)
            return httpx.Response(200, json={"id": 42})

        clients = self._install_plex_tv(monkeypatch, slow_owner)

        results = await asyncio.gather(*(plex.get_server_owner_id() for _ in range(5)))

        assert results == ["42"] * 5
        assert len(clients) == 1
        assert plex._owner_id_lookup is None

    async def test_lookup_has_a_three_second_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.services import plex

        clients = self._install_plex_tv(
            monkeypatch, lambda request: httpx.Response(200, json={"id": 42})
        )

        assert await plex.get_server_owner_id() == "42"
        assert [kwargs["timeout"] for kwargs in clients] == [3.0]

    @pytest.mark.parametrize("body", [{}, {"id": None}, {"id": ""}])
    async def test_missing_id_is_never_cached(
        self, monkeypatch: pytest.MonkeyPatch, body: dict[str, object]
    ) -> None:
        from app.services import plex

        clients = self._install_plex_tv(monkeypatch, lambda request: httpx.Response(200, json=body))

        assert await plex.get_server_owner_id() is None
        assert await plex.get_server_owner_id() is None
        assert plex._server_owner_id_cache == {}
        assert len(clients) == 2

    async def test_unreachable_plex_tv_returns_none_uncached(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        def unreachable(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("synthetic outage", request=request)

        self._install_plex_tv(monkeypatch, unreachable)

        assert await plex.get_server_owner_id() is None
        assert plex._server_owner_id_cache == {}

    async def test_boot_lookup_warms_the_cache_without_waiting(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        clients = self._install_plex_tv(
            monkeypatch, lambda request: httpx.Response(200, json={"id": 42})
        )

        plex.start_server_owner_lookup()
        task = plex._owner_id_lookup
        assert task is not None
        assert not task.done()
        await task

        assert plex._server_owner_id_cache == {"owner_id": "42"}
        assert await plex.get_server_owner_id() == "42"
        assert len(clients) == 1

    async def test_boot_lookup_is_skipped_without_plex_sign_in(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        monkeypatch.setattr(plex.settings, "plex_auth_enabled", False)

        plex.start_server_owner_lookup()

        assert plex._owner_id_lookup is None

    async def test_clear_forgets_the_lookup_in_flight(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        self._install_plex_tv(monkeypatch, lambda request: httpx.Response(200, json={"id": 42}))
        plex.start_server_owner_lookup()
        task = plex._owner_id_lookup

        plex.clear_server_owner_id_cache()

        assert plex._owner_id_lookup is None
        assert task is not None
        await task

    async def test_stop_cancels_a_lookup_still_running(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        async def never_answers(request: httpx.Request) -> httpx.Response:
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

        self._install_plex_tv(monkeypatch, never_answers)
        plex.start_server_owner_lookup()
        task = plex._owner_id_lookup
        assert task is not None

        # Wait without cancelling anything, so only stop's own cancel can end the lookup
        stopper = asyncio.create_task(plex.stop_server_owner_lookup())
        done, _ = await asyncio.wait({stopper}, timeout=1)

        assert stopper in done
        assert task.cancelled()
        assert plex._owner_id_lookup is None

    def test_app_lifespan_stops_the_lookup(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from fastapi.testclient import TestClient

        from app.main import app
        from app.services import plex

        monkeypatch.setattr(plex.settings, "plex_auth_enabled", False)

        with (
            patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
            patch("app.services.plex.stop_server_owner_lookup", new=AsyncMock()) as stop,
        ):
            with TestClient(app):
                stop.assert_not_awaited()
            stop.assert_awaited_once_with()

    def test_app_lifespan_starts_the_lookup(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from fastapi.testclient import TestClient

        from app.main import app
        from app.services import plex

        # Plex sign-in without a machine id fails startup validation; the
        # lookup itself is stubbed, so only the call matters here.
        monkeypatch.setattr(plex.settings, "plex_auth_enabled", False)

        with (
            patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
            patch("app.services.plex.start_server_owner_lookup") as start,
            TestClient(app),
        ):
            start.assert_called_once_with()


class TestDetermineRole:
    """Tests for determine_role function."""

    @pytest.mark.asyncio
    async def test_default_viewer_role(self) -> None:
        """Users get viewer role by default."""
        from app.services.plex import determine_role

        user = PlexUser(id="123", username="testuser", email="test@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value="999"),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "viewer"
            mock_settings.plex_admin_users = []
            role = await determine_role(user)
            assert role == "viewer"

    @pytest.mark.asyncio
    async def test_configured_admin_role(self) -> None:
        """Users get admin role when PLEX_DEFAULT_ROLE=admin."""
        from app.services.plex import determine_role

        user = PlexUser(id="123", username="testuser", email="test@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value="999"),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "admin"
            mock_settings.plex_admin_users = []
            role = await determine_role(user)
            assert role == "admin"

    @pytest.mark.asyncio
    async def test_server_owner_always_admin(self) -> None:
        """Server owner gets admin role regardless of default."""
        from app.services.plex import determine_role

        owner_id = "123"
        user = PlexUser(id=owner_id, username="serverowner", email="owner@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value=owner_id),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "viewer"  # Default is viewer
            mock_settings.plex_admin_users = []
            role = await determine_role(user)
            assert role == "admin"  # But owner gets admin

    @pytest.mark.asyncio
    async def test_admin_users_list(self) -> None:
        """Users in plex_admin_users list get admin role."""
        from app.services.plex import determine_role

        user = PlexUser(id="456", username="vipuser", email="vip@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value="999"),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "viewer"
            mock_settings.plex_admin_users = ["vipuser", "anotheradmin"]
            role = await determine_role(user)
            assert role == "admin"

    @pytest.mark.asyncio
    async def test_non_owner_with_admin_default(self) -> None:
        """Non-owner with admin default still gets admin."""
        from app.services.plex import determine_role

        user = PlexUser(id="456", username="regularuser", email="user@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value="999"),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "admin"
            mock_settings.plex_admin_users = []
            role = await determine_role(user)
            assert role == "admin"

    @pytest.mark.asyncio
    async def test_owner_detection_failure_uses_default(self) -> None:
        """When owner detection fails, uses default role."""
        from app.services.plex import determine_role

        user = PlexUser(id="123", username="testuser", email="test@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value=None),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "viewer"
            mock_settings.plex_admin_users = []
            role = await determine_role(user)
            assert role == "viewer"
