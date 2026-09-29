"""Authoritative media input resolution shared by all process entry points."""

from dataclasses import dataclass
from urllib.parse import urlsplit

from fastapi import HTTPException

from app.models.channel import Channel, GroupedChannelsResponse, validate_channel_id
from app.models.ersatztv import EPGChannel
from app.services.dispatcharr import get_grouped_channels, peek_grouped_channels
from app.services.ersatztv import get_channel_by_id
from app.services.ersatztv.m3u_parser import peek_channels as peek_ersatztv_channels
from app.services.ersatztv.refresh import run_feed_lookup


@dataclass(frozen=True)
class MediaChannel:
    channel: Channel
    stream_type: str


def checked_source(channel: Channel, stream_type: str) -> MediaChannel:
    parsed = urlsplit(channel.stream_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(503, "Channel has an unsupported media source")
    return MediaChannel(channel, stream_type)


@dataclass(frozen=True)
class CatalogueMatch:
    """A channel id looked up in the catalogues.

    complete says whether a None channel is final: it is False when a catalogue
    that could hold the id couldn't be read (a lookup) or has never loaded (a
    peek). ersatztv says the channel came from the ErsatzTV list.
    """

    channel: Channel | None
    complete: bool
    ersatztv: bool = False


def _in_grouped(grouped: GroupedChannelsResponse, channel_id: str) -> Channel | None:
    for channels in [*(group.channels for group in grouped.groups), grouped.ungrouped]:
        for channel in channels:
            if channel.id == channel_id:
                return channel
    return None


def _from_ersatztv(ersatz: EPGChannel) -> Channel:
    return Channel(id=ersatz.id, name=ersatz.name, stream_url=ersatz.stream_url, guide_id=ersatz.id)


async def find_catalogue_channel(channel_id: str, *, ersatztv: bool = True) -> CatalogueMatch:
    """Look a channel id up in the grouped Dispatcharr catalogue, then (if asked) ErsatzTV's.

    Uses the same authenticated catalogue as the picker (served stale during a
    Dispatcharr outage). It holds every HDHR channel too: both key a channel by
    its stream UUID, so there is no separate lineup fetch. Both go through their
    caches, so an unknown id never costs a request of its own.
    """
    complete = True
    try:
        grouped = await get_grouped_channels()
    except Exception:
        complete = False
    else:
        channel = _in_grouped(grouped, channel_id)
        if channel is not None:
            return CatalogueMatch(channel, complete=True)
    if not ersatztv:
        return CatalogueMatch(None, complete=complete)

    # Never refresh ErsatzTV at all when Dispatcharr already knows this ID.
    try:
        ersatz = await run_feed_lookup(get_channel_by_id, channel_id)
    except Exception:
        return CatalogueMatch(None, complete=False)
    if ersatz:
        return CatalogueMatch(_from_ersatztv(ersatz), complete=True, ersatztv=True)
    return CatalogueMatch(None, complete=complete)


def peek_catalogue_channel(channel_id: str) -> CatalogueMatch:
    """find_catalogue_channel from the cached catalogues only, expired or not.

    Never fetches, never schedules a refresh and never waits, so it can run on
    every channel update. The answer is incomplete while a catalogue that
    could hold the id has never loaded.
    """
    grouped = peek_grouped_channels()
    if grouped is not None:
        channel = _in_grouped(grouped, channel_id)
        if channel is not None:
            return CatalogueMatch(channel, complete=True)
    ersatz_channels = peek_ersatztv_channels()
    if ersatz_channels is not None:
        for ersatz in ersatz_channels:
            if ersatz.id == channel_id:
                return CatalogueMatch(_from_ersatztv(ersatz), complete=True, ersatztv=True)
    return CatalogueMatch(None, complete=grouped is not None and ersatz_channels is not None)


async def resolve_media_channel(channel_id: str) -> MediaChannel:
    """Resolve credentials/source from trusted catalogs, never request metadata."""
    try:
        validate_channel_id(channel_id)
    except ValueError:
        raise HTTPException(422, "Invalid channel identifier") from None
    match = await find_catalogue_channel(channel_id)
    if match.channel is not None:
        return checked_source(match.channel, "hls" if match.ersatztv else "mpegts")
    if not match.complete:
        raise HTTPException(503, "Channel catalog unavailable")
    raise HTTPException(404, "Channel not found")
