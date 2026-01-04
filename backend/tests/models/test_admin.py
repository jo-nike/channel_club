"""Tests for admin models."""

from datetime import datetime, timezone

import pytest

from app.models.admin import ActiveUser, ActiveUsersResponse, ActiveUsersTotals


class TestActiveUser:
    """Tests for ActiveUser model."""

    def test_creates_with_all_fields(self) -> None:
        """Should create model with all required fields."""
        connected_since = datetime(2026, 1, 4, 10, 30, 0, tzinfo=timezone.utc)
        user = ActiveUser(
            username="viewer1",
            channel="BBC One",
            connected_since=connected_since,
            bitrate_mbps=8.5,
        )

        assert user.username == "viewer1"
        assert user.channel == "BBC One"
        assert user.connected_since == connected_since
        assert user.bitrate_mbps == 8.5

    def test_channel_is_optional(self) -> None:
        """Should allow None for channel."""
        user = ActiveUser(
            username="viewer1",
            connected_since=datetime.now(timezone.utc),
            bitrate_mbps=8.5,
        )

        assert user.channel is None

    def test_serializes_with_camel_case(self) -> None:
        """Should serialize to camelCase JSON."""
        connected_since = datetime(2026, 1, 4, 10, 30, 0, tzinfo=timezone.utc)
        user = ActiveUser(
            username="viewer1",
            channel="BBC One",
            connected_since=connected_since,
            bitrate_mbps=8.5,
        )

        data = user.model_dump(by_alias=True)

        assert "connectedSince" in data
        assert "bitrateMbps" in data
        assert "connected_since" not in data
        assert "bitrate_mbps" not in data


class TestActiveUsersTotals:
    """Tests for ActiveUsersTotals model."""

    def test_creates_with_all_fields(self) -> None:
        """Should create model with all fields."""
        totals = ActiveUsersTotals(
            live_count=3,
            ersatztv_count=2,
            live_bitrate_mbps=25.5,
            ersatztv_bitrate_mbps=24.0,
            total_bitrate_mbps=49.5,
        )

        assert totals.live_count == 3
        assert totals.ersatztv_count == 2
        assert totals.live_bitrate_mbps == 25.5
        assert totals.ersatztv_bitrate_mbps == 24.0
        assert totals.total_bitrate_mbps == 49.5

    def test_serializes_with_camel_case(self) -> None:
        """Should serialize to camelCase JSON."""
        totals = ActiveUsersTotals(
            live_count=1,
            ersatztv_count=1,
            live_bitrate_mbps=8.5,
            ersatztv_bitrate_mbps=12.0,
            total_bitrate_mbps=20.5,
        )

        data = totals.model_dump(by_alias=True)

        assert "liveCount" in data
        assert "ersatztvCount" in data
        assert "liveBitrateMbps" in data
        assert "ersatztvBitrateMbps" in data
        assert "totalBitrateMbps" in data


class TestActiveUsersResponse:
    """Tests for ActiveUsersResponse model."""

    def test_creates_with_all_fields(self) -> None:
        """Should create model with all fields."""
        connected_since = datetime.now(timezone.utc)
        live_user = ActiveUser(
            username="live_viewer",
            channel="BBC One",
            connected_since=connected_since,
            bitrate_mbps=8.5,
        )
        ersatztv_user = ActiveUser(
            username="movie_viewer",
            channel="Action Movies",
            connected_since=connected_since,
            bitrate_mbps=12.0,
        )
        totals = ActiveUsersTotals(
            live_count=1,
            ersatztv_count=1,
            live_bitrate_mbps=8.5,
            ersatztv_bitrate_mbps=12.0,
            total_bitrate_mbps=20.5,
        )

        response = ActiveUsersResponse(
            live_users=[live_user],
            ersatztv_users=[ersatztv_user],
            totals=totals,
        )

        assert len(response.live_users) == 1
        assert len(response.ersatztv_users) == 1
        assert response.totals.total_bitrate_mbps == 20.5

    def test_serializes_with_camel_case(self) -> None:
        """Should serialize to camelCase JSON."""
        totals = ActiveUsersTotals(
            live_count=0,
            ersatztv_count=0,
            live_bitrate_mbps=0.0,
            ersatztv_bitrate_mbps=0.0,
            total_bitrate_mbps=0.0,
        )
        response = ActiveUsersResponse(
            live_users=[],
            ersatztv_users=[],
            totals=totals,
        )

        data = response.model_dump(by_alias=True)

        assert "liveUsers" in data
        assert "ersatztvUsers" in data
        assert "live_users" not in data
        assert "ersatztv_users" not in data
