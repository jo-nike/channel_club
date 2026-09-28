"""Tests for channel models."""

import pytest
from pydantic import ValidationError

from app.models.channel import Channel, DispatchrrFullChannel


class TestDispatchrrFullChannel:
    """Tests for DispatchrrFullChannel model."""

    def test_accepts_fractional_channel_number(self) -> None:
        """Dispatcharr allows numbers like 5.1; one must not fail the whole catalogue."""
        channel = DispatchrrFullChannel.model_validate(
            {"id": 1, "name": "TVA", "channel_number": 5.1, "uuid": "uuid-1"}
        )

        assert channel.channel_number == 5.1

    def test_accepts_whole_and_missing_channel_numbers(self) -> None:
        """Whole numbers still parse, and a channel may have no number."""
        whole = DispatchrrFullChannel.model_validate(
            {"id": 1, "name": "TSN", "channel_number": 28, "uuid": "uuid-1"}
        )
        missing = DispatchrrFullChannel.model_validate({"id": 2, "name": "X", "uuid": "uuid-2"})

        assert whole.channel_number == 28
        assert missing.channel_number is None


class TestChannel:
    """Tests for Channel model."""

    def test_create_channel_with_camel_case_aliases(self) -> None:
        """Channel should use camelCase for JSON serialization."""
        channel = Channel(
            id="uuid-abc123",
            name="TSN",
            stream_url="https://streams.domain.com/proxy/ts/stream/uuid-abc123",
            guide_id="1",
        )

        # Internal access uses snake_case
        assert channel.id == "uuid-abc123"
        assert channel.name == "TSN"
        assert channel.stream_url == "https://streams.domain.com/proxy/ts/stream/uuid-abc123"
        assert channel.guide_id == "1"

    def test_channel_json_serialization_uses_camel_case(self) -> None:
        """Channel JSON output should use camelCase field names."""
        channel = Channel(
            id="uuid-abc123",
            name="TSN",
            stream_url="https://streams.domain.com/proxy/ts/stream/uuid-abc123",
            guide_id="1",
        )

        json_data = channel.model_dump(by_alias=True)

        assert "streamUrl" in json_data
        assert "stream_url" not in json_data
        assert json_data["streamUrl"] == "https://streams.domain.com/proxy/ts/stream/uuid-abc123"
        assert "guideId" in json_data
        assert "guide_id" not in json_data
        assert json_data["guideId"] == "1"

    def test_channel_from_dict_with_camel_case(self) -> None:
        """Channel should parse camelCase input."""
        data = {
            "id": "uuid-abc123",
            "name": "TSN",
            "streamUrl": "https://streams.domain.com/proxy/ts/stream/uuid-abc123",
            "guideId": "1",
        }

        channel = Channel(**data)

        assert channel.stream_url == "https://streams.domain.com/proxy/ts/stream/uuid-abc123"
        assert channel.guide_id == "1"

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
            "guideId": "1",
        }

        request = SetChannelRequest(**data)

        assert request.id == "uuid-123"
        assert request.name == "TSN"
        assert request.stream_url == "https://streams.example.com/stream/uuid-123"
        assert request.guide_id == "1"

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
            guide_id="1",
        )
        response = CurrentChannelResponse(current_channel=channel)

        assert response.current_channel is not None
        assert response.current_channel.id == "uuid-123"
        assert response.current_channel.guide_id == "1"

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
            guide_id="1",
        )
        response = CurrentChannelResponse(current_channel=channel)

        json_data = response.model_dump(by_alias=True)

        assert "currentChannel" in json_data
        assert "current_channel" not in json_data
        assert "streamUrl" in json_data["currentChannel"]
        assert "stream_url" not in json_data["currentChannel"]
        assert "guideId" in json_data["currentChannel"]
        assert "guide_id" not in json_data["currentChannel"]

    def test_json_serialization_null_channel(self) -> None:
        """JSON output with null channel uses camelCase."""
        from app.models.channel import CurrentChannelResponse

        response = CurrentChannelResponse(current_channel=None)

        json_data = response.model_dump(by_alias=True)

        assert "currentChannel" in json_data
        assert json_data["currentChannel"] is None
