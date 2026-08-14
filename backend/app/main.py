import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.config import settings
from app.logging_config import configure_logging
from app.routers.admin import router as admin_router
from app.routers.auth import router as auth_router
from app.routers.cast import router as cast_router
from app.routers.channels import router as channels_router
from app.routers.epg import router as epg_router
from app.routers.ersatztv import router as ersatztv_router
from app.routers.gif import router as gif_router
from app.routers.highlight import router as highlight_router
from app.routers.nhl import router as nhl_router
from app.routers.settings import router as settings_router
from app.routers.websocket import router as websocket_router
from app.services.cast import cast_service
from app.services.dispatcharr import (
    DispatchrrUnavailableError,
    get_grouped_channels,
)
from app.services.highlight import highlight_service


def validate_auth_configuration() -> None:
    """Validate authentication configuration on startup."""
    if not settings.local_auth_enabled and not settings.plex_auth_enabled:
        logger.warning(
            "No authentication methods enabled! "
            "Set LOCAL_AUTH_ENABLED=true or PLEX_AUTH_ENABLED=true"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    # Startup
    configure_logging()
    logger.info(
        "IPTV Viewer API starting",
        version="0.1.0",
        log_level=settings.log_level,
        log_format=settings.log_format,
    )
    if settings.highlight_enabled:
        logger.info(
            "Highlight capture enabled (buffer: {}s, segments: {}s)",
            settings.highlight_buffer_seconds,
            settings.highlight_segment_seconds,
        )
        # Clean up any stale segments from previous runs
        highlight_service.cleanup_stale_segments()
        # Start background task to clean up idle recorders
        highlight_service.start_idle_cleanup_task()
    if settings.cast_enabled:
        logger.info(
            "Chromecast streaming enabled (segment: {}s, buffer: {}s)",
            settings.cast_hls_segment_time,
            settings.cast_hls_segment_time * settings.cast_hls_list_size,
        )
        # Clean up any stale sessions from previous runs
        cast_service.cleanup_stale_sessions()
        # Start background task to clean up idle sessions
        cast_service.start_idle_cleanup_task()
    validate_auth_configuration()

    # Warm the channel groups cache in the background so the first admin
    # modal open doesn't block on a cold Dispatcharr fetch.
    async def _warm_channels_cache() -> None:
        try:
            await get_grouped_channels()
            logger.info("Channel groups cache warmed")
        except DispatchrrUnavailableError as e:
            logger.warning("Channel cache warmup skipped: {}", str(e))
        except Exception as e:  # noqa: BLE001
            logger.warning("Channel cache warmup failed: {}", str(e))

    asyncio.create_task(_warm_channels_cache())

    yield
    # Shutdown
    logger.info("IPTV Viewer API shutting down")
    # Stop idle cleanup task and all highlight recorders
    highlight_service.stop_idle_cleanup_task()
    await highlight_service.stop_all()
    # Stop all cast sessions
    await cast_service.stop_all()


app = FastAPI(title="IPTV Viewer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://192.168.50.167:5173",
        "http://192.168.50.167:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers FIRST (they take precedence over static files)
app.include_router(auth_router, prefix="/api/auth")
app.include_router(channels_router, prefix="/api")
app.include_router(epg_router, prefix="/api")
app.include_router(ersatztv_router)
app.include_router(admin_router, prefix="/api/admin")
app.include_router(settings_router, prefix="/api")
app.include_router(cast_router)
app.include_router(gif_router)
app.include_router(highlight_router)
app.include_router(nhl_router)
app.include_router(websocket_router)


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


# Static file serving for production (when running in Docker container)
# The static directory contains the built frontend assets
static_path = Path(__file__).parent.parent / "static"

if static_path.exists():
    # Mount assets directory for JS, CSS, and other static files
    assets_path = static_path / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    # Serve index.html for the root path
    @app.get("/")
    async def serve_root() -> FileResponse:
        return FileResponse(static_path / "index.html")

    # Catch-all route for SPA client-side routing
    # This must be defined AFTER all other routes
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        # Check if requesting a static file that exists
        file_path = static_path / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        # Otherwise return index.html for SPA routing
        return FileResponse(static_path / "index.html")
