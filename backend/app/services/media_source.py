"""Authoritative media input resolution shared by all process entry points."""

import asyncio
from dataclasses import dataclass
from urllib.parse import urlsplit

from fastapi import HTTPException

from app.models.channel import Channel, validate_channel_id
from app.services.dispatcharr import get_lineup
from app.services.ersatztv import get_channel_by_id


@dataclass(frozen=True)
class MediaChannel:
    channel: Channel
    stream_type: str


def checked_source(channel: Channel, stream_type: str) -> MediaChannel:
    parsed = urlsplit(channel.stream_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(503, "Channel has an unsupported media source")
    return MediaChannel(channel, stream_type)


async def resolve_media_channel(channel_id: str) -> MediaChannel:
    """Resolve credentials/source from trusted catalogs, never request metadata."""
    try:
        validate_channel_id(channel_id)
    except ValueError:
        raise HTTPException(422, "Invalid channel identifier") from None
    try:
        ersatz = await asyncio.to_thread(get_channel_by_id, channel_id)
        if ersatz:
            return checked_source(
                Channel(
                    id=ersatz.id, name=ersatz.name, streamUrl=ersatz.stream_url, guideId=ersatz.id
                ),
                "hls",
            )
        lineup = await get_lineup()
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(503, "Channel catalog unavailable") from None
    for channel in lineup:
        if channel.id == channel_id:
            return checked_source(channel, "mpegts")
    raise HTTPException(404, "Channel not found")
