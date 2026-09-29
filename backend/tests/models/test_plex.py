"""Tests for Plex authentication models."""

import pytest
from pydantic import ValidationError

from app.models.plex import PlexAuthRequest, PlexUser


class TestPlexAuthRequest:
    """Tests for PlexAuthRequest model."""

    def test_plex_auth_request_with_camel_case_alias(self) -> None:
        """PlexAuthRequest accepts authToken as camelCase alias."""
        request = PlexAuthRequest.model_validate({"authToken": "test-token"})
        assert request.auth_token == "test-token"

    def test_plex_auth_request_with_snake_case(self) -> None:
        """PlexAuthRequest accepts auth_token as snake_case."""
        request = PlexAuthRequest(auth_token="test-token")
        assert request.auth_token == "test-token"

    def test_plex_auth_request_serializes_to_camel_case(self) -> None:
        """PlexAuthRequest serializes to camelCase by alias."""
        request = PlexAuthRequest(auth_token="test-token")
        data = request.model_dump(by_alias=True)
        assert "authToken" in data
        assert data["authToken"] == "test-token"

    def test_plex_auth_request_requires_token(self) -> None:
        """PlexAuthRequest requires auth_token field."""
        with pytest.raises(ValidationError):
            PlexAuthRequest()  # pyright: ignore[reportCallIssue]


class TestPlexUser:
    """Tests for PlexUser model."""

    def test_plex_user_with_all_fields(self) -> None:
        """PlexUser accepts all fields including optional thumb."""
        user = PlexUser(
            id="12345",
            username="testuser",
            email="test@example.com",
            thumb="https://plex.tv/users/avatar.png",
        )
        assert user.id == "12345"
        assert user.username == "testuser"
        assert user.email == "test@example.com"
        assert user.thumb == "https://plex.tv/users/avatar.png"

    def test_plex_user_without_optional_thumb(self) -> None:
        """PlexUser works without optional thumb field."""
        user = PlexUser(
            id="12345",
            username="testuser",
            email="test@example.com",
        )
        assert user.id == "12345"
        assert user.thumb is None

    def test_plex_user_requires_id(self) -> None:
        """PlexUser requires id field."""
        with pytest.raises(ValidationError):
            PlexUser(username="testuser", email="test@example.com")  # pyright: ignore[reportCallIssue]

    def test_plex_user_requires_username(self) -> None:
        """PlexUser requires username field."""
        with pytest.raises(ValidationError):
            PlexUser(id="12345", email="test@example.com")  # pyright: ignore[reportCallIssue]

    def test_plex_user_requires_email(self) -> None:
        """PlexUser requires email field."""
        with pytest.raises(ValidationError):
            PlexUser(id="12345", username="testuser")  # pyright: ignore[reportCallIssue]
