"""MEDIA-07: all HLS subresources stay behind the stream session's proxy."""

import re
from urllib.parse import parse_qs, urlsplit

import pytest

from app.services.ersatztv.hls_rewriter import decode_url, rewrite_manifest

SID = "S" * 32
PLAYLIST_PATH = f"/api/ersatztv/s/{SID}/stream.m3u8"
SEGMENT_PREFIX = f"/api/ersatztv/s/{SID}/segments/"


def test_query_variant_is_rewritten_as_playlist():
    output = rewrite_manifest("#EXTM3U\nvariant.m3u8?session=123", "http://source/dir/", SID)
    url = urlsplit(output.splitlines()[1])
    assert url.path == PLAYLIST_PATH
    assert decode_url(parse_qs(url.query)["url"][0]) == "http://source/dir/variant.m3u8?session=123"


def test_line_after_stream_inf_is_a_playlist_whatever_its_extension():
    """C-07: RFC 8216 4.3.4.2, the URI after EXT-X-STREAM-INF is a Media Playlist."""
    output = rewrite_manifest(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=42\nhls?mode=segmenter\n", "http://source/dir/", SID
    )
    url = urlsplit(output.splitlines()[2])
    assert url.path == PLAYLIST_PATH
    assert decode_url(parse_qs(url.query)["url"][0]) == "http://source/dir/hls?mode=segmenter"


def test_stream_inf_marks_only_the_next_uri_line():
    """A bare URI after the variant's URI line keeps the extension heuristic."""
    output = rewrite_manifest(
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=42\nvariant\n#EXTINF:4,\nlive000010\n",
        "http://source/dir/",
        SID,
    )
    lines = output.splitlines()
    assert urlsplit(lines[2]).path == PLAYLIST_PATH
    segment = urlsplit(lines[4])
    assert segment.path.startswith(SEGMENT_PREFIX)
    assert decode_url(segment.path.rsplit("/", 1)[1]) == "http://source/dir/live000010"


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
def test_uri_attributes_go_through_the_session_without_a_token(tag, uri, playlist):
    """H-01: a session manifest carries the session id and never a token."""
    output = rewrite_manifest(f'#EXTM3U\n#{tag}"{uri}"', "http://source/dir/", SID)
    match = re.search(r'URI="([^"]+)"', output)
    assert match
    assert "token" not in output
    rewritten = urlsplit(match[1])
    if playlist:
        assert rewritten.path == PLAYLIST_PATH
        assert list(parse_qs(rewritten.query)) == ["url"]
        encoded = parse_qs(rewritten.query)["url"][0]
    else:
        assert rewritten.path.startswith(SEGMENT_PREFIX)
        assert rewritten.query == ""
        encoded = rewritten.path.rsplit("/", 1)[1]
    assert decode_url(encoded) == "http://source/dir/" + uri
