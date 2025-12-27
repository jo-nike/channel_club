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
