"""Local-only media integration fixture; launched by check-hls-proxy.mjs."""

import json
import socket
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# This script deliberately bypasses dotenv and uses only a synthetic signing key.
from unittest.mock import patch

from pydantic import SecretStr
from pydantic_settings import DotEnvSettingsSource

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
with patch.object(DotEnvSettingsSource, "_read_env_files", return_value={}):
    from app.config import settings

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from loguru import logger

from app.models.ersatztv import EPGChannel
from app.routers import ersatztv
from app.services.auth import create_access_token

workspace = Path(sys.argv[1])
bundle = Path(sys.argv[2])
# The proxy only fetches ErsatzTV's streaming paths, so the media lives under one
media = workspace / "iptv" / "session" / "fixture"
media.mkdir(parents=True)
logger.remove()
settings.jwt_secret = SecretStr("local-browser-fixture-signing-key-only-32-bytes")


def ffmpeg(*args):
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
        check=True,
        timeout=30,
        cwd=media,
    )


ffmpeg(
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=25",
    "-t",
    "8",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "50",
    "-sc_threshold",
    "0",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "0",
    "-hls_segment_type",
    "fmp4",
    "-hls_segment_filename",
    "video_%03d.m4s",
    "video.m3u8",
)
ffmpeg(
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "8",
    "-c:a",
    "aac",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "0",
    "-hls_segment_filename",
    "audio_%03d.ts",
    "audio.m3u8",
)
(media / "subtitles.m3u8").write_text(
    "#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:0\n"
    "#EXTINF:8,\ncaption.vtt\n#EXT-X-ENDLIST\n"
)
(media / "caption.vtt").write_text(
    "WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n\n"
    "00:00.000 --> 00:08.000\nControlled synthetic subtitle\n"
)
(media / "master.m3u8").write_text(
    "#EXTM3U\n#EXT-X-VERSION:7\n"
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Tone",DEFAULT=YES,AUTOSELECT=YES,'
    'URI="audio.m3u8?fixture=audio"\n'
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,'
    'AUTOSELECT=YES,LANGUAGE="en",URI="subtitles.m3u8?fixture=subtitles"\n'
    '#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=160x90,CODECS="avc1.42c00b,mp4a.40.2",'
    'AUDIO="audio",SUBTITLES="subs"\nvideo.m3u8?fixture=nested\n'
)
(media / "secret.key").write_bytes(bytes(range(16)))
(media / "keyinfo").write_text("secret.key\n" + str(media / "secret.key") + "\n")
ffmpeg(
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=25",
    "-t",
    "6",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "50",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "0",
    "-hls_key_info_file",
    str(media / "keyinfo"),
    "-hls_segment_filename",
    "encrypted_%03d.ts",
    "encrypted.m3u8",
)

upstream_requests = []


class Upstream(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass

    def do_GET(self):
        upstream_requests.append(self.path)
        super().do_GET()


upstream = ThreadingHTTPServer(("127.0.0.1", 0), partial(Upstream, directory=str(workspace)))
threading.Thread(target=upstream.serve_forever, daemon=True).start()
settings.ersatztv_base_url = f"http://127.0.0.1:{upstream.server_port}"


def channel(identifier):
    if identifier not in {"synthetic", "encrypted"}:
        return None
    filename = "master.m3u8" if identifier == "synthetic" else "encrypted.m3u8"
    return EPGChannel(
        id=identifier,
        name="Synthetic fixture",
        stream_url=f"{settings.ersatztv_base_url}/iptv/session/fixture/{filename}",
    )


ersatztv.get_channel_by_id = channel
app = FastAPI()
app.include_router(ersatztv.router)
token = create_access_token({"sub": "synthetic-browser-viewer", "role": "viewer"})


@app.get("/fixture.json")
def config():
    return {"token": token, "upstream": settings.ersatztv_base_url, "requests": upstream_requests}


@app.get("/hls.js")
def hls_bundle():
    return FileResponse(bundle, media_type="text/javascript")


@app.get("/probe.html")
def probe():
    return HTMLResponse("""<!doctype html><title>Controlled HLS browser regression</title>
<script src="/hls.js"></script><video id="video" muted autoplay playsinline></video>
<script>
window.errors=[];window.player=null;
window.playFixture=async function(channel,token){
  window.player?.destroy();window.errors=[];window.fixtureReady=false;
  const video=document.getElementById('video');
  const hls=new Hls({enableWorker:false,lowLatencyMode:false});window.player=hls;
  hls.on(Hls.Events.FRAG_BUFFERED,()=>{window.fixtureReady=true});
  hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED,()=>{hls.subtitleDisplay=true;hls.subtitleTrack=0});
  hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal)window.errors.push(data.details)});
  hls.on(Hls.Events.MANIFEST_PARSED,()=>{hls.subtitleTrack=0;video.play().catch(e=>window.errors.push(String(e)))});
  const response=await fetch('/api/ersatztv/session',{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify({channelId:channel})});
  if(!response.ok){window.errors.push('stream session '+response.status);return false}
  hls.attachMedia(video);hls.loadSource((await response.json()).url);
  return true;
}
</script>""")


listener = socket.socket()
listener.bind(("127.0.0.1", 0))
print(json.dumps({"origin": f"http://127.0.0.1:{listener.getsockname()[1]}"}), flush=True)
try:
    uvicorn.Server(uvicorn.Config(app, log_level="critical")).run(sockets=[listener])
finally:
    upstream.shutdown()
