"""Tests for channel models."""

import pytest
from pydantic import ValidationError

from app.models.channel import Channel, DispatchrrChannel


class TestDispatchrrChannel:
    """Tests for DispatchrrChannel model."""

    def test_parse_from_dispatcharr_format(self) -> None:
        """Parse channel data from Dispatcharr's HDHomeRun format."""
        raw_data = {
            "GuideNumber": "1.1",
            "GuideName": "TSN",
            "URL": "http://10.8.0.2:9191/proxy/ts/stream/uuid-abc123",
        }

        channel = DispatchrrChannel(**raw_data)

        assert channel.guide_number == "1.1"
        assert channel.guide_name == "TSN"
        assert channel.url == "http://10.8.0.2:9191/proxy/ts/stream/uuid-abc123"

    def test_parse_multiple_channels(self) -> None:
        """Parse multiple channels from Dispatcharr response."""
        raw_channels = [
            {
                "GuideNumber": "1.1",
                "GuideName": "TSN",
                "URL": "http://10.8.0.2:9191/proxy/ts/stream/uuid-1",
            },
            {
                "GuideNumber": "2.1",
                "GuideName": "Sportsnet",
                "URL": "http://10.8.0.2:9191/proxy/ts/stream/uuid-2",
            },
        ]

        channels = [DispatchrrChannel(**c) for c in raw_channels]

        assert len(channels) == 2
        assert channels[0].guide_name == "TSN"
        assert channels[1].guide_name == "Sportsnet"

    def test_missing_required_field_raises_error(self) -> None:
        """Missing required field should raise ValidationError."""
        raw_data = {
            "GuideNumber": "1.1",
            "GuideName": "TSN",
            # Missing URL
        }

        with pytest.raises(ValidationError):
            DispatchrrChannel(**raw_data)


class TestChannel:
    """Tests for Channel model."""

    def test_create_channel_with_camel_case_aliases(self) -> None:
        """Channel should use camelCase for JSON serialization."""
        channel = Channel(id="uuid-abc123", name="TSN", stream_url="https://streams.domain.com/proxy/ts/stream/uuid-abc123")

        # Internal access uses snake_case
        assert channel.id == "uuid-abc123"
        assert channel.name == "TSN"
        assert channel.stream_url == "https://streams.domain.com/proxy/ts/stream/uuid-abc123"

    def test_channel_json_serialization_uses_camel_case(self) -> None:
        """Channel JSON output should use camelCase field names."""
        channel = Channel(id="uuid-abc123", name="TSN", stream_url="https://streams.domain.com/proxy/ts/stream/uuid-abc123")

        json_data = channel.model_dump(by_alias=True)

        assert "streamUrl" in json_data
        assert "stream_url" not in json_data
        assert json_data["streamUrl"] == "https://streams.domain.com/proxy/ts/stream/uuid-abc123"

    def test_channel_from_dict_with_camel_case(self) -> None:
        """Channel should parse camelCase input."""
        data = {
            "id": "uuid-abc123",
            "name": "TSN",
            "streamUrl": "https://streams.domain.com/proxy/ts/stream/uuid-abc123",
        }

        channel = Channel(**data)

        assert channel.stream_url == "https://streams.domain.com/proxy/ts/stream/uuid-abc123"

    def test_missing_required_field_raises_error(self) -> None:
        """Missing required field should raise ValidationError."""
        data = {
            "id": "uuid-abc123",
            "name": "TSN",
            # Missing streamUrl
        }

        with pytest.raises(ValidationError):
            Channel(**data)


class TestSetChannelRequest:
    """Tests for SetChannelRequest model."""

    def test_create_from_camel_case_input(self) -> None:
        """Parse request with camelCase field names."""
        from app.models.channel import SetChannelRequest

        data = {
            "id": "uuid-123",
            "name": "TSN",
            "streamUrl": "https://streams.example.com/stream/uuid-123",
        }

        request = SetChannelRequest(**data)

        assert request.id == "uuid-123"
        assert request.name == "TSN"
        assert request.stream_url == "https://streams.example.com/stream/uuid-123"

    def test_missing_required_field_raises_error(self) -> None:
        """Missing required field should raise ValidationError."""
        from app.models.channel import SetChannelRequest

        data = {
            "id": "uuid-123",
            "name": "TSN",
            # Missing streamUrl
        }

        with pytest.raises(ValidationError):
            SetChannelRequest(**data)


class TestCurrentChannelResponse:
    """Tests for CurrentChannelResponse model."""

    def test_with_channel(self) -> None:
        """Response with a channel."""
        from app.models.channel import CurrentChannelResponse

        channel = Channel(
            id="uuid-123",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-123",
        )
        response = CurrentChannelResponse(current_channel=channel)

        assert response.current_channel is not None
        assert response.current_channel.id == "uuid-123"

    def test_with_null_channel(self) -> None:
        """Response with null channel."""
        from app.models.channel import CurrentChannelResponse

        response = CurrentChannelResponse(current_channel=None)

        assert response.current_channel is None

    def test_json_serialization_uses_camel_case(self) -> None:
        """JSON output should use camelCase field names."""
        from app.models.channel import CurrentChannelResponse

        channel = Channel(
            id="uuid-123",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-123",
        )
        response = CurrentChannelResponse(current_channel=channel)

        json_data = response.model_dump(by_alias=True)

        assert "currentChannel" in json_data
        assert "current_channel" not in json_data
        assert "streamUrl" in json_data["currentChannel"]
        assert "stream_url" not in json_data["currentChannel"]

    def test_json_serialization_null_channel(self) -> None:
        """JSON output with null channel uses camelCase."""
        from app.models.channel import CurrentChannelResponse

        response = CurrentChannelResponse(current_channel=None)

        json_data = response.model_dump(by_alias=True)

        assert "currentChannel" in json_data
        assert json_data["currentChannel"] is None
