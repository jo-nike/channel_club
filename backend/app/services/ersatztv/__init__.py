"""ErsatzTV service modules."""

from app.services.ersatztv.epg_service import (
    get_channel_by_id,
    get_channels,
    get_current_programme,
    get_programmes_by_channel,
    get_upcoming_programmes,
    refresh_all,
    reset_state,
)
from app.services.ersatztv.hls_rewriter import (
    decode_url,
    rewrite_manifest,
)
from app.services.ersatztv.m3u_parser import clear_cache as clear_m3u_cache
from app.services.ersatztv.m3u_parser import parse_m3u_playlist
from app.services.ersatztv.xmltv_parser import clear_cache as clear_xmltv_cache
from app.services.ersatztv.xmltv_parser import get_health as get_guide_health
from app.services.ersatztv.xmltv_parser import parse_xmltv

__all__ = [
    "parse_m3u_playlist",
    "clear_m3u_cache",
    "parse_xmltv",
    "clear_xmltv_cache",
    "get_channels",
    "get_channel_by_id",
    "get_current_programme",
    "get_programmes_by_channel",
    "get_upcoming_programmes",
    "refresh_all",
    "reset_state",
    "get_guide_health",
    # HLS proxy service
    "rewrite_manifest",
    "decode_url",
]
