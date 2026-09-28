"""Authoritative media input resolution shared by all process entry points."""

import asyncio
from dataclasses import dataclass
from urllib.parse import urlsplit

from fastapi import HTTPException

from app.models.channel import Channel, validate_channel_id
from app.services.dispatcharr import get_grouped_channels
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
    unavailable = False
    # Use the same authenticated catalog as the picker (served stale during a
    # Dispatcharr outage). It holds every HDHR channel too: both key a channel
    # by its stream UUID, so there is no separate lineup fetch.
    try:
        grouped = await get_grouped_channels()
    except Exception:
        unavailable = True
    else:
        for channels in [*(group.channels for group in grouped.groups), grouped.ungrouped]:
            for channel in channels:
                if channel.id == channel_id:
                    return checked_source(channel, "mpegts")

    # Never refresh ErsatzTV at all when Dispatcharr already knows this ID.
    try:
        ersatz = await asyncio.to_thread(get_channel_by_id, channel_id)
    except Exception:
        unavailable = True
        ersatz = None
    if ersatz:
        return checked_source(
            Channel(id=ersatz.id, name=ersatz.name, streamUrl=ersatz.stream_url, guideId=ersatz.id),
            "hls",
        )
    if unavailable:
        raise HTTPException(503, "Channel catalog unavailable")
    raise HTTPException(404, "Channel not found")
