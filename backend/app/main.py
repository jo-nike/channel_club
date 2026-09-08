import asyncio
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.config import KNOWN_PUBLIC_JWT_SECRETS, settings
from app.logging_config import configure_logging
from app.metadata import APP_NAME, APP_VERSION
from app.routers.admin import router as admin_router
from app.routers.auth import router as auth_router
from app.routers.cast import router as cast_router
from app.routers.channels import router as channels_router
from app.routers.epg import router as epg_router
from app.routers.ersatztv import router as ersatztv_router
from app.routers.feedback import router as feedback_router
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
    """Validate authentication configuration on startup.

    Raises:
        RuntimeError: If Plex auth is enabled without a server machine ID, or if
            an auth method is enabled while JWTs are signed with the dev secret.
    """
    # These signing keys are published (this source, the .env.example template),
    # so anyone can forge a token — including {"role": "admin"}. This is NOT
    # gated on an auth method being enabled: verify_token/get_current_user run on
    # every protected request regardless of the login flags, so a forged
    # default-secret token authenticates even with local/Plex auth turned off.
    # Refuse to start on any known-public secret, full stop.
    if settings.jwt_secret in KNOWN_PUBLIC_JWT_SECRETS:
        raise RuntimeError(
            "JWT_SECRET is a known-public placeholder value. It is published in "
            "the source or .env.example, so anyone can forge an admin token. Set "
            "JWT_SECRET to a strong random value (e.g. `openssl rand -hex 32`)."
        )

    if len(settings.jwt_secret.strip()) < 32:
        raise RuntimeError(
            "JWT_SECRET must contain at least 32 non-padding characters. "
            "Generate a random secret with `openssl rand -hex 32`."
        )

    # Refuse to start rather than serve an open door. check_server_access()
    # returns True when plex_server_machine_id is unset, so without it ANY
    # valid Plex account on the internet authenticates and is issued a JWT
    # with PLEX_DEFAULT_ROLE. Once Plex is the only enabled method, that is a
    # silent authentication bypass — far better to fail the deploy loudly.
    if settings.plex_auth_enabled and not settings.plex_server_machine_id:
        raise RuntimeError(
            "PLEX_AUTH_ENABLED is true but PLEX_SERVER_MACHINE_ID is not set. "
            "Without it, server access checks pass for any Plex account. "
            "Set PLEX_SERVER_MACHINE_ID or disable Plex auth."
        )

    if not settings.local_auth_enabled and not settings.plex_auth_enabled:
        logger.warning(
            "No authentication methods enabled! "
            "Set LOCAL_AUTH_ENABLED=true or PLEX_AUTH_ENABLED=true"
        )

    # Local auth with no passwords configured rejects every login attempt.
    # Non-fatal, but silent 401s are a miserable thing to debug.
    if settings.local_auth_enabled and not (settings.admin_password or settings.viewer_password):
        logger.warning(
            "LOCAL_AUTH_ENABLED is true but neither ADMIN_PASSWORD nor "
            "VIEWER_PASSWORD is set — every local login will be rejected"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    # Startup
    configure_logging()
    logger.info(
        "Channel Club API starting",
        version=APP_VERSION,
        log_level=settings.log_level,
        log_format=settings.log_format,
    )
    validate_auth_configuration()
    if settings.zipline_enabled and not settings.zipline_available:
        logger.warning(
            "Zipline uploads unavailable: enable highlights and configure "
            "ZIPLINE_URL and ZIPLINE_TOKEN"
        )
    if settings.ntfy_enabled and not settings.ntfy_available:
        logger.warning(
            "Feedback push unavailable: configure NTFY_URL (http/https base URL) "
            "and NTFY_TOPIC (letters, digits, '_' or '-')"
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

    # The event loop only holds a weak reference to a running task, so keep a
    # strong one for the app's lifetime — otherwise the warmup can be collected
    # mid-fetch and the cache silently stays cold.
    app.state.warmup_task = asyncio.create_task(_warm_channels_cache())

    yield
    # Shutdown
    logger.info("Channel Club API shutting down")
    # Cancel the warmup if a restart lands mid-fetch, rather than tearing the
    # loop down with a pending task.
    app.state.warmup_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.warmup_task
    # Stop idle cleanup task and all highlight recorders
    highlight_service.stop_idle_cleanup_task()
    await highlight_service.stop_all()
    # Stop all cast sessions
    await cast_service.stop_all()


app = FastAPI(title=f"{APP_NAME} API", version=APP_VERSION, lifespan=lifespan)

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
app.include_router(feedback_router)
app.include_router(highlight_router)
app.include_router(nhl_router)
app.include_router(websocket_router)


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "buildId": settings.app_build_id,
        "revision": settings.app_revision,
    }


# Static file serving for production (when running in Docker container)
# The static directory contains the built frontend assets
static_path = Path(__file__).parent.parent / "static"

if static_path.exists():
    # Symlink-resolved root the SPA catch-all confines every request to
    static_root = static_path.resolve()

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
        # uvicorn percent-decodes the request path without normalising "..", so
        # a request for /%2e%2e%2f%2e%2e%2fetc%2fpasswd arrives here verbatim.
        # Resolve the join and serve it only if it stays inside the static root,
        # otherwise the catch-all hands out any file the process can read.
        # resolve()/is_file() touch the filesystem, so a percent-encoded NUL
        # (/%00) or other malformed path raises ValueError/OSError — swallow it
        # and fall back to the SPA rather than 500-ing with a traceback.
        try:
            file_path = (static_path / full_path).resolve()
            if file_path.is_relative_to(static_root) and file_path.is_file():
                return FileResponse(file_path)
        except (ValueError, OSError):
            pass
        # Otherwise return index.html for SPA routing
        return FileResponse(static_path / "index.html")
