"""MEDIA-07: all HLS subresources stay behind the authenticated proxy."""

import re
from urllib.parse import parse_qs, urlsplit

import pytest

from app.services.ersatztv.hls_rewriter import decode_url, rewrite_manifest


@pytest.mark.parametrize(
    "tag,uri,playlist",
    [
        ("EXT-X-KEY:METHOD=AES-128,URI=", "key.bin?key=a,b", False),
        ("EXT-X-MAP:URI=", "init.mp4", False),
        ("EXT-X-MEDIA:TYPE=AUDIO,URI=", "audio?session=1", True),
        ("EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=42,URI=", "iframe.m3u8?q=1", True),
        ("EXT-X-RENDITION-REPORT:URI=", "rendition", True),
    ],
)
def test_rewrites_uri_attributes(tag, uri, playlist):
    output = rewrite_manifest(
        f'#EXTM3U\n#{tag}"{uri}"', "http://source/dir/", "token&safe", "channel"
    )
    match = re.search(r'URI="([^"]+)"', output)
    assert match
    rewritten = urlsplit(match[1])
    assert parse_qs(rewritten.query)["token"] == ["token&safe"]
    encoded = parse_qs(rewritten.query)["url"][0] if playlist else rewritten.path.rsplit("/", 1)[1]
    assert decode_url(encoded) == "http://source/dir/" + uri
    assert ("/stream/" in rewritten.path) is playlist


def test_query_variant_is_rewritten_as_playlist():
    output = rewrite_manifest(
        "#EXTM3U\nvariant.m3u8?session=123", "http://source/dir/", "token", "channel"
    )
    url = urlsplit(output.splitlines()[1])
    assert url.path == "/api/ersatztv/stream/channel"
    assert decode_url(parse_qs(url.query)["url"][0]) == "http://source/dir/variant.m3u8?session=123"


def test_line_after_stream_inf_is_a_playlist_whatever_its_extension():
    """C-07: RFC 8216 4.3.4.2, the URI after EXT-X-STREAM-INF is a Media Playlist."""
    output = rewrite_manifest(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=42\nhls?mode=segmenter\n",
        "http://source/dir/",
        "token",
        "channel",
    )
    url = urlsplit(output.splitlines()[2])
    assert url.path == "/api/ersatztv/stream/channel"
    assert decode_url(parse_qs(url.query)["url"][0]) == "http://source/dir/hls?mode=segmenter"


def test_stream_inf_marks_only_the_next_uri_line():
    """A bare URI after the variant's URI line keeps the extension heuristic."""
    output = rewrite_manifest(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=42\nvariant\n#EXTINF:4,\nlive000010\n",
        "http://source/dir/",
        "token",
        "channel",
    )
    lines = output.splitlines()
    assert urlsplit(lines[2]).path == "/api/ersatztv/stream/channel"
    segment = urlsplit(lines[4])
    assert segment.path.startswith("/api/ersatztv/segments/")
    assert decode_url(segment.path.rsplit("/", 1)[1]) == "http://source/dir/live000010"
