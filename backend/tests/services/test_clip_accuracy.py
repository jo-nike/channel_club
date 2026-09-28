"""Real exports cut between widely spaced keyframes and preserve audio timing."""

import array
import json
import math
import shutil
import subprocess

import pytest

from app.services.media_export import encode_file

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg required")


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, timeout=20).stdout


@pytest.fixture
def preview(tmp_path):
    source = tmp_path / "preview.mp4"
    run(
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "nullsrc=s=32x32:r=25:d=5,geq=lum='16+N*1.5':cb=128:cr=128",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=if(between(t\\,2\\,2.4)\\,0.5*sin(2*PI*440*t)\\,0):s=48000:d=5",
        "-c:v",
        "libx264",
        "-g",
        "250",
        "-keyint_min",
        "250",
        "-sc_threshold",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        str(source),
    )
    return source


@pytest.mark.parametrize("format", ["mp4", "webm"])
async def test_fractional_cut_content_duration_and_audio(preview, tmp_path, format):
    result = tmp_path / f"clip.{format}"
    await encode_file(preview, result, format, 1.32, 3.72)
    metadata = json.loads(
        run("ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(result))
    )
    assert abs(float(metadata["format"]["duration"]) - 2.4) < 0.1
    assert {stream["codec_type"] for stream in metadata["streams"]} == {"video", "audio"}
    frames = run(
        "ffmpeg",
        "-v",
        "error",
        "-i",
        str(result),
        "-vf",
        "scale=1:1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1",
    )
    original = run(
        "ffmpeg",
        "-v",
        "error",
        "-i",
        str(preview),
        "-vf",
        "scale=1:1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1",
    )
    assert abs(frames[0] - original[33]) <= 3
    assert abs(frames[-1] - original[92]) <= 3
    assert abs(len(frames) - 60) <= 1
    pcm = array.array(
        "h",
        run(
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(result),
            "-vn",
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            "48000",
            "pipe:1",
        ),
    )

    # The source's tone at 2s must begin 0.68s into the selection.
    def rms(start, end):
        samples = pcm[int(start * 48000) : int(end * 48000)]
        return math.sqrt(sum(float(x) ** 2 for x in samples) / len(samples))

    assert rms(0.2, 0.5) < 100
    assert rms(0.75, 0.95) > 3000
    assert rms(1.2, 1.5) < 100


@pytest.mark.parametrize(
    "start,end", [(float("nan"), 2), (0, float("inf")), (-1, 2), (2, 2), (0, 6), (0, 0.01)]
)
async def test_invalid_ranges_fail_before_encoding(preview, tmp_path, start, end):
    with pytest.raises(ValueError):
        await encode_file(preview, tmp_path / "bad.mp4", "mp4", start, end)
    assert not (tmp_path / "bad.mp4").exists()


async def test_trimmed_segment_manifest_uses_normalized_duration(preview, tmp_path):
    segment = tmp_path / "input.ts"
    run("ffmpeg", "-v", "error", "-i", str(preview), "-c", "copy", str(segment))
    manifest = tmp_path / "concat.txt"
    manifest.write_text("file 'input.ts'\n")
    output = tmp_path / "clip.mp4"
    await encode_file(manifest, output, "mp4", 1.32, 3.72, concat=True)
    data = json.loads(run("ffprobe", "-v", "error", "-show_format", "-of", "json", str(output)))
    assert abs(float(data["format"]["duration"]) - 2.4) < 0.1


async def test_capture_waits_for_completed_segment(tmp_path):
    from unittest.mock import MagicMock

    from app.services.highlight import ChannelRecorder

    recorder = ChannelRecorder("synthetic", "http://fixture")
    recorder.segment_dir = tmp_path
    recorder.process = MagicMock()
    recorder.process.poll.return_value = None
    (tmp_path / "seg_000.ts").write_bytes(b"incomplete segment")
    assert not recorder.has_completed_segment()
    (tmp_path / "segments.txt").write_text("seg_000.ts\n")
    assert recorder.has_completed_segment()
    (tmp_path / "seg_000.ts").write_bytes(b"")
    assert not recorder.has_completed_segment()


async def test_capture_store_evicts_the_oldest_per_owner_and_expires(
    preview, tmp_path, monkeypatch
):
    from pathlib import Path

    from app.config import settings
    from app.services.highlight import (
        CAPTURE_TTL_SECONDS,
        MAX_CAPTURES_PER_OWNER,
        CaptureStore,
        ChannelRecorder,
    )

    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))

    class CopyingRecorder(ChannelRecorder):
        async def capture(self, output: Path) -> float:
            shutil.copyfile(preview, output)
            return 0.0

    class BrokenRecorder(ChannelRecorder):
        async def capture(self, output: Path) -> float:
            raise ValueError("Recorder not running")

    copying = CopyingRecorder("synthetic", "http://fixture")
    broken = BrokenRecorder("synthetic", "http://fixture")
    store = CaptureStore()
    first = await store.create(copying, "viewer", "channel-1", 0.0)
    assert first.path.exists() and first.size == preview.stat().st_size
    assert abs(first.duration - 5) < 0.2
    assert store.get(first.id, "viewer") is first
    assert store.get(first.id, "other") is None
    assert store.issue_download_token(first.id, "other") is None
    replaced_link = store.issue_download_token(first.id, "viewer")
    assert replaced_link is not None

    # Another device on the same account clips without deleting the capture being edited.
    kept = [await store.create(copying, "viewer", "channel-1", 0.0) for _ in range(2)]
    assert MAX_CAPTURES_PER_OWNER == 3
    assert all(store.get(item.id, "viewer") is item for item in [first, *kept])
    second = await store.create(copying, "viewer", "channel-1", 0.0)
    assert not first.path.parent.exists() and store.get(first.id, "viewer") is None
    assert all(store.get(item.id, "viewer") is item for item in kept)
    # A replaced capture takes its download links with it.
    assert store.redeem_download_token(replaced_link) is None
    second_link = store.issue_download_token(second.id, "viewer")
    assert second_link is not None
    other = await store.create(copying, "other", "channel-1", 0.0)
    assert second.path.exists() and other.path.exists()

    with pytest.raises(ValueError):
        await store.create(broken, "viewer", "channel-1", 0.0)
    assert sorted(item.name for item in (tmp_path / "captures").iterdir()) == sorted(
        [*(item.id for item in kept), second.id, other.id]
    )

    await store.sweep(now=other.created_at + CAPTURE_TTL_SECONDS)
    assert store.captures == {} and not (second.path.exists() or other.path.exists())
    assert store.download_tokens == {}
