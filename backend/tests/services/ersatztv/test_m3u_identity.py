"""MEDIA-13: malformed entries cannot steal streams or collide with channel IDs."""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from app.models.ersatztv import Programme
from app.services.ersatztv.epg_service import get_programmes_by_channel
from app.services.ersatztv.m3u_parser import _parse_m3u_content
from app.services.ersatztv.xmltv_parser import guide


def test_missing_url_does_not_consume_next_metadata_record():
    channels = _parse_m3u_content(
        '#EXTM3U\n#EXTINF:-1 tvg-id="one",One\n#EXTINF:-1 tvg-id="two",Two\nhttp://source/two'
    )
    assert [(c.id, c.stream_url) for c in channels] == [("two", "http://source/two")]


async def test_suffix_collision_stays_unique_and_preserves_xmltv_identity():
    text = "#EXTM3U\n" + "\n".join(
        f'#EXTINF:-1 tvg-id="{id}",{id}\nhttp://source/{index}'
        for index, id in enumerate(["a", "a_3", "a", "a_4", "a"])
    )
    channels = _parse_m3u_content(text)
    assert len({c.id for c in channels}) == 5
    assert [c.id for c in _parse_m3u_content(text)] == [c.id for c in channels]
    assert channels[2].xmltv_id == "a"
    now = datetime.now(UTC)
    programme = Programme(
        id="a_original",
        channel_id="a",
        title="Same provider guide",
        start=now,
        stop=now + timedelta(hours=1),
    )
    guide._cache = {"a": [programme]}
    guide._cache_expires = now + timedelta(minutes=5)
    with patch("app.services.ersatztv.epg_service.parse_m3u_playlist", return_value=channels):
        mapped = await get_programmes_by_channel(channels[2].id)
    assert mapped[0].channel_id == channels[2].id
    assert mapped[0].title == programme.title
    assert programme.channel_id == "a"
