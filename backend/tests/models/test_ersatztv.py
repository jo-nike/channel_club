"""Tests for ErsatzTV models."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models.ersatztv import (
    CurrentProgrammeResponse,
    EPGChannel,
    EPGChannelResponse,
    Programme,
    ProgrammeListResponse,
    PublicEPGChannel,
)


class TestEPGChannel:
    """Tests for EPGChannel model."""

    def test_create_epg_channel_with_required_fields(self) -> None:
        """EPGChannel should be created with required fields."""
        channel = EPGChannel(
            id="test-channel-1",
            name="Test Channel",
            stream_url="http://example.com/stream.m3u8",
        )

        assert channel.id == "test-channel-1"
        assert channel.name == "Test Channel"
        assert channel.stream_url == "http://example.com/stream.m3u8"
        assert channel.logo_url is None
        assert channel.number is None
        assert channel.group is None

    def test_create_epg_channel_with_all_fields(self) -> None:
        """EPGChannel should accept all optional fields."""
        channel = EPGChannel(
            id="test-channel-1",
            name="Test Channel",
            stream_url="http://example.com/stream.m3u8",
            logo_url="http://example.com/logo.png",
            number=42,
            group="Movies",
        )

        assert channel.logo_url == "http://example.com/logo.png"
        assert channel.number == 42
        assert channel.group == "Movies"

    def test_epg_channel_json_serialization_uses_camel_case(self) -> None:
        """EPGChannel JSON output should use camelCase field names."""
        channel = EPGChannel(
            id="test-1",
            name="Test Channel",
            stream_url="http://example.com/stream.m3u8",
            logo_url="http://example.com/logo.png",
        )

        json_data = channel.model_dump(by_alias=True)

        assert "streamUrl" in json_data
        assert "stream_url" not in json_data
        assert json_data["streamUrl"] == "http://example.com/stream.m3u8"
        assert "logoUrl" in json_data
        assert "logo_url" not in json_data
        assert json_data["logoUrl"] == "http://example.com/logo.png"

    def test_epg_channel_from_camel_case_input(self) -> None:
        """EPGChannel should parse camelCase input."""
        data = {
            "id": "test-1",
            "name": "Test Channel",
            "streamUrl": "http://example.com/stream.m3u8",
            "logoUrl": "http://example.com/logo.png",
        }

        channel = EPGChannel.model_validate(data)

        assert channel.stream_url == "http://example.com/stream.m3u8"
        assert channel.logo_url == "http://example.com/logo.png"

    def test_epg_channel_missing_required_field_raises_error(self) -> None:
        """Missing required field should raise ValidationError."""
        with pytest.raises(ValidationError):
            # Missing stream_url
            EPGChannel(id="test-1", name="Test Channel")  # pyright: ignore[reportCallIssue]


class TestProgramme:
    """Tests for Programme model."""

    def test_create_programme_with_required_fields(self) -> None:
        """Programme should be created with required fields."""
        start = datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)
        stop = datetime(2025, 1, 1, 11, 0, 0, tzinfo=UTC)

        prog = Programme(
            id="prog-1",
            channel_id="ch-1",
            title="Test Show",
            start=start,
            stop=stop,
        )

        assert prog.id == "prog-1"
        assert prog.channel_id == "ch-1"
        assert prog.title == "Test Show"
        assert prog.start == start
        assert prog.stop == stop
        assert prog.description is None
        assert prog.category is None

    def test_create_programme_with_all_fields(self) -> None:
        """Programme should accept all optional fields."""
        start = datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)
        stop = datetime(2025, 1, 1, 11, 0, 0, tzinfo=UTC)

        prog = Programme(
            id="prog-1",
            channel_id="ch-1",
            title="Test Show",
            description="A great show",
            start=start,
            stop=stop,
            category=["Drama", "Action"],
        )

        assert prog.description == "A great show"
        assert prog.category == ["Drama", "Action"]

    def test_programme_json_serialization_uses_camel_case(self) -> None:
        """Programme JSON output should use camelCase field names."""
        start = datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)
        stop = datetime(2025, 1, 1, 11, 0, 0, tzinfo=UTC)

        prog = Programme(
            id="prog-1",
            channel_id="ch-1",
            title="Test Show",
            start=start,
            stop=stop,
        )

        json_data = prog.model_dump(by_alias=True)

        assert "channelId" in json_data
        assert "channel_id" not in json_data
        assert json_data["channelId"] == "ch-1"

    def test_programme_from_camel_case_input(self) -> None:
        """Programme should parse camelCase input."""
        start = datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)
        stop = datetime(2025, 1, 1, 11, 0, 0, tzinfo=UTC)

        data = {
            "id": "prog-1",
            "channelId": "ch-1",
            "title": "Test Show",
            "start": start,
            "stop": stop,
        }

        prog = Programme(**data)

        assert prog.channel_id == "ch-1"

    def test_programme_missing_required_field_raises_error(self) -> None:
        """Missing required field should raise ValidationError."""
        start = datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)

        with pytest.raises(ValidationError):
            Programme(  # pyright: ignore[reportCallIssue]
                id="prog-1",
                channel_id="ch-1",
                title="Test Show",
                start=start,
                # Missing stop
            )


class TestEPGChannelResponse:
    """Tests for EPGChannelResponse model."""

    def test_create_response_with_channels(self) -> None:
        """EPGChannelResponse should contain list of channels."""
        channels = [
            EPGChannel(
                id="ch-1",
                name="Channel 1",
                stream_url="http://example.com/ch1.m3u8",
            ),
            EPGChannel(
                id="ch-2",
                name="Channel 2",
                stream_url="http://example.com/ch2.m3u8",
            ),
        ]

        response = EPGChannelResponse(channels=[PublicEPGChannel.from_channel(c) for c in channels])

        assert len(response.channels) == 2
        assert response.channels[0].id == "ch-1"
        assert response.channels[1].id == "ch-2"

    def test_create_response_with_empty_list(self) -> None:
        """EPGChannelResponse should accept empty list."""
        response = EPGChannelResponse(channels=[])

        assert response.channels == []


class TestCurrentProgrammeResponse:
    """Tests for CurrentProgrammeResponse model."""

    def test_create_response_with_current_and_next(self) -> None:
        """CurrentProgrammeResponse should contain current and next programmes."""
        start1 = datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)
        stop1 = datetime(2025, 1, 1, 11, 0, 0, tzinfo=UTC)
        start2 = datetime(2025, 1, 1, 11, 0, 0, tzinfo=UTC)
        stop2 = datetime(2025, 1, 1, 12, 0, 0, tzinfo=UTC)

        current = Programme(
            id="prog-1",
            channel_id="ch-1",
            title="Current Show",
            start=start1,
            stop=stop1,
        )
        next_up = Programme(
            id="prog-2",
            channel_id="ch-1",
            title="Next Show",
            start=start2,
            stop=stop2,
        )

        response = CurrentProgrammeResponse(
            channel_id="ch-1",
            current=current,
            next_up=next_up,
        )

        assert response.channel_id == "ch-1"
        assert response.current is not None
        assert response.current.title == "Current Show"
        assert response.next_up is not None
        assert response.next_up.title == "Next Show"

    def test_create_response_with_null_programmes(self) -> None:
        """CurrentProgrammeResponse should accept null programmes."""
        response = CurrentProgrammeResponse(
            channel_id="ch-1",
            current=None,
            next_up=None,
        )

        assert response.current is None
        assert response.next_up is None

    def test_json_serialization_uses_camel_case(self) -> None:
        """CurrentProgrammeResponse JSON should use camelCase."""
        response = CurrentProgrammeResponse(
            channel_id="ch-1",
            current=None,
            next_up=None,
        )

        json_data = response.model_dump(by_alias=True)

        assert "channelId" in json_data
        assert "channel_id" not in json_data
        assert "nextUp" in json_data
        assert "next_up" not in json_data


class TestProgrammeListResponse:
    """Tests for ProgrammeListResponse model."""

    def test_create_response_with_programmes(self) -> None:
        """ProgrammeListResponse should contain list of programmes."""
        start = datetime(2025, 1, 1, 10, 0, 0, tzinfo=UTC)
        stop = datetime(2025, 1, 1, 11, 0, 0, tzinfo=UTC)

        programmes = [
            Programme(
                id="prog-1",
                channel_id="ch-1",
                title="Show 1",
                start=start,
                stop=stop,
            ),
        ]

        response = ProgrammeListResponse(
            channel_id="ch-1",
            programmes=programmes,
        )

        assert response.channel_id == "ch-1"
        assert len(response.programmes) == 1
        assert response.programmes[0].title == "Show 1"

    def test_json_serialization_uses_camel_case(self) -> None:
        """ProgrammeListResponse JSON should use camelCase."""
        response = ProgrammeListResponse(
            channel_id="ch-1",
            programmes=[],
        )

        json_data = response.model_dump(by_alias=True)

        assert "channelId" in json_data
        assert "channel_id" not in json_data
