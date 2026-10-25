import asyncio
import os
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.config import KNOWN_PUBLIC_JWT_SECRETS, OBSOLETE_ENV_KEYS, settings
from app.logging_config import configure_logging
from app.metadata import APP_NAME, APP_VERSION
from app.middleware.body_limit import BodySizeLimitMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.routers.admin import router as admin_router
from app.routers.admin_config import router as admin_config_router
from app.routers.auth import router as auth_router
from app.routers.cast import router as cast_router
from app.routers.channels import router as channels_router
from app.routers.csp_report import router as csp_report_router
from app.routers.epg import router as epg_router
from app.routers.ersatztv import router as ersatztv_router
from app.routers.feedback import router as feedback_router
from app.routers.gif import router as gif_router
from app.routers.highlight import router as highlight_router
from app.routers.nhl import router as nhl_router
from app.routers.settings import router as settings_router
from app.routers.setup import router as setup_router
from app.routers.websocket import router as websocket_router
from app.services import (
    app_settings,
    channel_state,
    gauges,
    plex,
    presence,
    presence_broadcast,
    settings_store,
    state_store,
)
from app.services.cached_fetch import aclose_all_caches
from app.services.cast import cast_service
from app.services.dispatcharr import (
    DispatchrrUnavailableError,
    catalogue_failing,
    get_grouped_channels,
    refresh_catalogue_if_due,
)
from app.services.epg_service import get_epg_service
from app.services.ersatztv.refresh import stop_feed_executor
from app.services.highlight import highlight_service
from app.services.http_clients import aclose_http_clients
from app.services.passwords import local_accounts
from app.spa import mount_spa


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
    jwt_secret = settings.jwt_secret.get_secret_value()
    if jwt_secret in KNOWN_PUBLIC_JWT_SECRETS:
        raise RuntimeError(
            "JWT_SECRET is a known-public placeholder value. It is published in "
            "the source or .env.example, so anyone can forge an admin token. Set "
            "JWT_SECRET to a strong random value (e.g. `openssl rand -hex 32`)."
        )

    if len(jwt_secret.strip()) < 32:
        raise RuntimeError(
            "JWT_SECRET must contain at least 32 non-padding characters. "
            "Generate a random secret with `openssl rand -hex 32`."
        )

    # Refuse to start rather than serve an open door. check_server_access()
    # returns True when plex_server_machine_id is unset, so without it ANY
    # valid Plex account on the internet authenticates and is issued a JWT.
    # Once Plex is the only enabled method, that is a
    # silent authentication bypass — far better to fail the deploy loudly.
    if settings.plex_auth_enabled and not settings.plex_server_machine_id:
        raise RuntimeError(
            "PLEX_AUTH_ENABLED is true but PLEX_SERVER_MACHINE_ID is not set. "
            "Without it, server access checks pass for any Plex account. "
            "Set PLEX_SERVER_MACHINE_ID or disable Plex auth."
        )

    # While setup is open its own warning says what to do (settings_store.start)
    no_sign_in = not settings.local_auth_enabled and not settings.plex_auth_enabled
    if no_sign_in and settings_store.setup_state() != "unclaimed":
        logger.warning(
            "No authentication methods enabled! "
            "Set LOCAL_AUTH_ENABLED=true or PLEX_AUTH_ENABLED=true"
        )

    # Local auth with no passwords configured rejects every login attempt.
    # Non-fatal, but silent 401s are a miserable thing to debug. A password
    # saved from the app (a hash) counts as much as one in the environment.
    if settings.local_auth_enabled and not any(a.usable for a in local_accounts(settings)):
        logger.warning(
            "Local sign-in is on but neither login has a password (ADMIN_PASSWORD, "
            "VIEWER_PASSWORD or one saved in the app), so every local login will be rejected"
        )


def preflight() -> None:
    """The startup checks, without serving: run.sh calls this before launching.

    Loads the saved settings (generating and saving the signing key when the
    environment has none), then validates auth, as the lifespan does.

    Raises:
        RuntimeError: As settings_store.start() and validate_auth_configuration().
    """
    settings_store.start()
    validate_auth_configuration()


# Shutdown teardown's budget, after uvicorn's own graceful timeout (Dockerfile)
# and inside the compose stop_grace_period.
SHUTDOWN_DEADLINE_SECONDS = 8


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    # Settings saved from the app first: they can change the signing key, the
    # log level, auth and the features everything below reads.
    settings_store.start()
    # Startup: a structured event, so the dashboard can mark deploys
    logger.info(
        "Channel Club API starting",
        event="server.start",
        version=APP_VERSION,
        build_id=settings.app_build_id,
        log_level=settings.log_level,
        log_format=settings.log_format,
    )
    validate_auth_configuration()
    # Put the admin settings back before serving; Live is re-resolved against
    # the catalogue in the background, so a Dispatcharr outage never blocks start.
    if settings.state_file:
        state = state_store.load()
        app_settings.restore_app_settings(state)
        channel_state.start_restore_task(state["liveChannelId"])
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
    for key, source in (("DISPATCHARR_URL", "Dispatcharr"), ("ERSATZTV_BASE_URL", "ErsatzTV")):
        if not getattr(settings, key.lower()):
            logger.warning("{} is not set, so {} channels are unavailable", key, source)
    for key, replacement in OBSOLETE_ENV_KEYS.items():
        if key in os.environ:
            logger.warning("{} is no longer read: {}", key, replacement)
    if not settings.chat_enabled:
        logger.warning("Chat is off: CHAT_ENABLED is false, so clients hide chat")
    if settings.highlight_enabled:
        logger.info(
            "Highlight capture enabled (buffer: {}s, segments: {}s)",
            settings.highlight_buffer_seconds,
            settings.highlight_segment_seconds,
        )
        # Clean up any stale segments from previous runs
        highlight_service.cleanup_stale_segments()
    logger.info(
        "Chromecast streaming (segment: {}s, buffer: {}s)",
        settings.cast_hls_segment_time,
        settings.cast_hls_segment_time * settings.cast_hls_list_size,
    )
    # Clean up any stale sessions from previous runs
    cast_service.cleanup_stale_sessions()
    # The clips sweep runs whether or not clips are on: they can be switched on
    # from the app, and while they are off it finds nothing to do
    highlight_service.start_idle_cleanup_task()
    cast_service.start_idle_cleanup_task()

    # Sweep presence for tabs that vanished without closing their socket, so
    # stale viewers disappear even when no admin is polling Active Users.
    presence.start_cleanup_task()
    # Look up the Plex server owner id now: require_admin needs it to tell the
    # owner from a demoted admin, and the cache is empty after every deploy.
    plex.start_server_owner_lookup()
    # One gauges log line a minute: sockets, recorders, budgets, FDs, FFmpeg children.
    gauges.start_gauges_task()

    # Warm the channel groups and guide caches in the background so the first
    # admin modal open or channel list doesn't block on a cold Dispatcharr fetch.
    # A failed guide download here starts the EPG backoff before anyone waits.
    async def _warm_caches() -> None:
        channels, guide = await asyncio.gather(
            get_grouped_channels(),
            get_epg_service().ensure_fresh(),
            return_exceptions=True,
        )
        if isinstance(channels, DispatchrrUnavailableError):
            logger.warning("Channel cache warmup skipped: {}", str(channels))
        elif isinstance(channels, BaseException):
            logger.warning("Channel cache warmup failed: {}", str(channels))
        else:
            logger.info("Channel groups cache warmed")
        # A failed refresh has already logged its reason in refresh_cache
        if isinstance(guide, BaseException):
            logger.warning("Guide cache warmup failed: {}", str(guide))
        elif guide.online:
            logger.info("Guide cache warmed")

    # The event loop only holds a weak reference to a running task, so keep a
    # strong one for the app's lifetime — otherwise the warmup can be collected
    # mid-fetch and the cache silently stays cold.
    app.state.warmup_task = asyncio.create_task(_warm_caches())
    # Last, so the restore's recorder starts after the stale segment cleanup above
    await channel_state.wait_for_restore(channel_state.RESTORE_STARTUP_WAIT_SECONDS)

    yield
    # Shutdown
    logger.info("Channel Club API shutting down")
    presence.stop_cleanup_task()
    presence_broadcast.cancel_pending()

    async def _stop_warmup() -> None:
        # Cancel the warmup if a restart lands mid-fetch, rather than tearing the
        # loop down with a pending task.
        app.state.warmup_task.cancel()
        with suppress(asyncio.CancelledError):
            await app.state.warmup_task

    async def _stop_highlights() -> None:
        # The sweep may be mid-stop; let it finish before stopping the rest.
        await highlight_service.stop_idle_cleanup_task()
        await highlight_service.stop_all()

    # Teardowns run concurrently under one deadline that fits Docker's stop
    # grace period. A new teardown is one more entry in this list.
    teardowns = [
        _stop_warmup(),
        plex.stop_server_owner_lookup(),
        _stop_highlights(),
        cast_service.stop_all(),
        channel_state.stop_reconcile_task(),
        channel_state.stop_failed_closes(),
        channel_state.stop_restore_task(),
        presence.stop_stale_closes(),
        aclose_all_caches(),
        stop_feed_executor(),
        gauges.stop_gauges_task(),
        aclose_http_clients(),
    ]
    try:
        async with asyncio.timeout(SHUTDOWN_DEADLINE_SECONDS):
            results = await asyncio.gather(*teardowns, return_exceptions=True)
    except TimeoutError:
        logger.warning("Shutdown teardown cut off at its {}s deadline", SHUTDOWN_DEADLINE_SECONDS)
    else:
        for result in results:
            if isinstance(result, BaseException):
                logger.warning("Shutdown teardown failed: {!r}", result)


# Configure at import, before uvicorn logs 'Started server process', so every
# line from startup on goes through the JSON sink. configure_logging is idempotent.
configure_logging()

app = FastAPI(
    title=f"{APP_NAME} API",
    version=APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Wraps routing and CORS: oversize bodies get 413 before routing.
app.add_middleware(
    BodySizeLimitMiddleware,
    max_bytes=lambda: settings.request_body_max_bytes,
    exempt_paths=frozenset({"/api/highlight/upload"}),
)
# Added last so it wraps everything, the body cap's 413 included.
# Read per request, so a Dispatcharr address saved in the app reaches the CSP at once
app.add_middleware(SecurityHeadersMiddleware, stream_base_url=lambda: settings.dispatcharr_url)

# Register API routers FIRST (they take precedence over static files)
app.include_router(auth_router, prefix="/api/auth")
app.include_router(channels_router, prefix="/api")
app.include_router(epg_router, prefix="/api")
app.include_router(ersatztv_router)
app.include_router(admin_router, prefix="/api/admin")
app.include_router(admin_config_router, prefix="/api/admin")
app.include_router(settings_router, prefix="/api")
app.include_router(setup_router, prefix="/api/setup")
app.include_router(cast_router)
app.include_router(gif_router)
app.include_router(feedback_router)
app.include_router(csp_report_router)
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


@app.get("/api/health/deps")
async def health_deps() -> dict[str, str | None]:
    """Coarse upstream readiness for the uptime monitor, from local state only.

    Public, so it carries no URLs, error text or counts, and it never waits on
    an upstream. When the guide or the Dispatcharr catalogue is due and not
    backing off it starts one background refresh of it (at most one per TTL or
    backoff window), so on an idle app 'stale' and 'failing' mean the refresh
    is failing, not that nobody asked. The Docker healthcheck stays on
    /api/health: an upstream outage must not get this container restarted.
    """
    guide = await get_epg_service().check_health()
    refresh_catalogue_if_due()
    if not guide.online:
        epg = "failing"
    elif guide.stale:
        epg = "stale"
    else:
        epg = "ok"
    return {
        "epg": epg,
        "epgLastSuccess": guide.last_success_at.isoformat() if guide.last_success_at else None,
        "dispatcharr": "failing" if catalogue_failing() else "ok",
    }


# Static file serving for production (when running in Docker container)
# The static directory contains the built frontend assets
static_path = Path(__file__).parent.parent / "static"

if static_path.exists():
    mount_spa(app, static_path)
