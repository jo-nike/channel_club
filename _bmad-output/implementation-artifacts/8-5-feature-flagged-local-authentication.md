# Story 8.5: Feature-Flagged Local Authentication

Status: review

## Story

As a deployer,
I want local (credential-based) authentication to be feature-flagged,
so that I can disable it when using Plex-only authentication.

## Acceptance Criteria

1. **Local Auth Disabled**: When `LOCAL_AUTH_ENABLED=false` (or not set), POST `/api/auth/token` returns 404 Not Found
2. **Local Auth Enabled**: When `LOCAL_AUTH_ENABLED=true`, POST `/api/auth/token` with valid credentials authenticates normally
3. **Startup Warning**: When both `LOCAL_AUTH_ENABLED=false` AND `PLEX_AUTH_ENABLED=false`, log warning "No authentication methods enabled"
4. **Login Page Update**: When `LOCAL_AUTH_ENABLED=false` AND `PLEX_AUTH_ENABLED=true`, only "Sign in with Plex" button shown (no credential form)

## Tasks / Subtasks

- [x] Task 1: Add LOCAL_AUTH_ENABLED to config (AC: #1, #2)
  - [x] Add `local_auth_enabled: bool = False` to Settings class in `config.py`
  - [x] Default to `False` (opt-in for security)
- [x] Task 2: Update /api/auth/token endpoint (AC: #1, #2)
  - [x] Check `local_auth_enabled` before processing login
  - [x] Return 404 if disabled (same behavior as Plex endpoint when disabled)
  - [x] Process normally if enabled
- [x] Task 3: Add startup validation (AC: #3)
  - [x] Add check in `main.py` on startup
  - [x] Log warning if no auth methods enabled
  - [x] Continue running (don't crash) - admin might configure later
- [x] Task 4: Update /api/auth/config endpoint (AC: #4)
  - [x] Include `localAuthEnabled` in response
  - [x] Frontend already handles conditional rendering (Story 8.4)
- [x] Task 5: Update .env.example with documentation
  - [x] Add LOCAL_AUTH_ENABLED with clear description
  - [x] Document default behavior (false = disabled)
- [x] Task 6: Write tests (AC: #1-4)
  - [x] Test /api/auth/token returns 404 when disabled
  - [x] Test /api/auth/token works when enabled
  - [x] Test startup warning is logged
  - [x] Test /api/auth/config returns correct values

## Dev Notes

### Architecture Compliance

- **Config pattern**: Settings via pydantic-settings
- **Router pattern**: Check feature flag before processing
- **Logging pattern**: Use Python logging for warnings

### Technical Implementation

**Config Updates** (`backend/app/config.py`):
```python
class Settings(BaseSettings):
    # ... existing settings ...

    # Authentication Feature Flags
    local_auth_enabled: bool = False  # Enable username/password auth
    plex_auth_enabled: bool = False   # Enable Plex OAuth

    # Local Auth Credentials (only used when local_auth_enabled=True)
    admin_username: str = "admin"
    admin_password: str = "admin"
    viewer_username: str = "viewer"
    viewer_password: str = "viewer"
```

**Updated Auth Router** (`backend/app/routers/auth.py`):
```python
from fastapi import APIRouter, HTTPException, status
from app.config import settings
from app.models.auth import LoginRequest, TokenResponse, AuthConfigResponse
from app.services.auth import create_access_token

router = APIRouter(tags=["auth"])


@router.get("/config", response_model=AuthConfigResponse)
async def get_auth_config() -> AuthConfigResponse:
    """Return available authentication methods."""
    return AuthConfigResponse(
        local_auth_enabled=settings.local_auth_enabled,
        plex_auth_enabled=settings.plex_auth_enabled
    )


@router.post("/token", response_model=TokenResponse)
async def login(request: LoginRequest) -> TokenResponse:
    """Authenticate user with username/password and return JWT token.

    Raises:
        HTTPException: 404 if local auth is disabled
        HTTPException: 401 if credentials are invalid
    """
    # Check if local auth is enabled
    if not settings.local_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Check admin credentials
    if (
        request.username == settings.admin_username
        and request.password == settings.admin_password
    ):
        role = "admin"
    # Check viewer credentials
    elif (
        request.username == settings.viewer_username
        and request.password == settings.viewer_password
    ):
        role = "viewer"
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = create_access_token({"sub": request.username, "role": role})
    return TokenResponse(access_token=token, role=role)


@router.post("/plex", response_model=TokenResponse)
async def login_with_plex(request: PlexAuthRequest) -> TokenResponse:
    """Authenticate using Plex token.

    Raises:
        HTTPException: 404 if Plex auth is disabled
        HTTPException: 401 if Plex token is invalid
        HTTPException: 403 if no server access
    """
    if not settings.plex_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # ... rest of Plex auth logic from Story 8.1
```

**Startup Validation** (`backend/app/main.py`):
```python
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.config import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    validate_auth_configuration()
    yield
    # Shutdown


def validate_auth_configuration():
    """Validate authentication configuration on startup."""
    if not settings.local_auth_enabled and not settings.plex_auth_enabled:
        logger.warning(
            "⚠️  No authentication methods enabled! "
            "Set LOCAL_AUTH_ENABLED=true or PLEX_AUTH_ENABLED=true"
        )


app = FastAPI(lifespan=lifespan)
```

**Auth Models Update** (`backend/app/models/auth.py`):
```python
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """Request body for local login."""
    username: str
    password: str


class TokenResponse(BaseModel):
    """Response for successful authentication."""
    access_token: str = Field(alias="accessToken")
    token_type: str = "bearer"
    role: str

    class Config:
        populate_by_name = True


class AuthConfigResponse(BaseModel):
    """Response for GET /api/auth/config."""
    local_auth_enabled: bool = Field(alias="localAuthEnabled")
    plex_auth_enabled: bool = Field(alias="plexAuthEnabled")

    class Config:
        populate_by_name = True
```

### Migration Notes

**BREAKING CHANGE**: Existing deployments using local auth must add `LOCAL_AUTH_ENABLED=true` to their environment.

**Migration steps:**
1. Add `LOCAL_AUTH_ENABLED=true` to `.env` before upgrading
2. Deploy new version
3. Verify login still works
4. Optionally enable Plex auth with `PLEX_AUTH_ENABLED=true`
5. Optionally disable local auth later with `LOCAL_AUTH_ENABLED=false`

### Environment Variables

Update `.env.example`:
```bash
# ======================
# Authentication Settings
# ======================

# Feature Flags (both default to false)
LOCAL_AUTH_ENABLED=true        # Enable username/password authentication
PLEX_AUTH_ENABLED=false        # Enable Plex OAuth authentication

# Local Auth Credentials (only used when LOCAL_AUTH_ENABLED=true)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-admin-password
VIEWER_USERNAME=viewer
VIEWER_PASSWORD=your-secure-viewer-password

# Plex Auth Settings (only used when PLEX_AUTH_ENABLED=true)
PLEX_SERVER_TOKEN=             # Your Plex server token
PLEX_SERVER_MACHINE_ID=        # Your Plex server machine identifier
PLEX_DEFAULT_ROLE=viewer       # Default role for Plex users (viewer or admin)
PLEX_ADMIN_USERS=              # Comma-separated Plex usernames who get admin role
```

### Dependencies

- Story 8.4 (Conditional Login UI) handles frontend conditional rendering
- This story completes the feature flag system for all auth methods

### Project Structure Notes

Modified files:
- `backend/app/config.py` (add local_auth_enabled)
- `backend/app/routers/auth.py` (add feature flag check to /token)
- `backend/app/main.py` (add startup validation)
- `backend/app/models/auth.py` (add AuthConfigResponse)
- `backend/.env.example` (update documentation)
- `.env.example` (update documentation)
- `backend/tests/routers/test_auth.py` (update tests)

### Testing Requirements

```python
import pytest
import logging
from unittest.mock import patch
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_local_auth_returns_404_when_disabled(client_local_disabled):
    """Local auth endpoint returns 404 when LOCAL_AUTH_ENABLED=false"""
    response = await client_local_disabled.post(
        "/api/auth/token",
        json={"username": "admin", "password": "admin"}
    )
    assert response.status_code == 404

@pytest.mark.asyncio
async def test_local_auth_works_when_enabled(client_local_enabled):
    """Local auth endpoint works when LOCAL_AUTH_ENABLED=true"""
    response = await client_local_enabled.post(
        "/api/auth/token",
        json={"username": "admin", "password": "admin"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "accessToken" in data
    assert data["role"] == "admin"

@pytest.mark.asyncio
async def test_auth_config_returns_correct_flags(client):
    """Auth config endpoint returns correct feature flags"""
    with patch("app.routers.auth.settings") as mock_settings:
        mock_settings.local_auth_enabled = True
        mock_settings.plex_auth_enabled = False

        response = await client.get("/api/auth/config")
        assert response.status_code == 200
        data = response.json()
        assert data["localAuthEnabled"] == True
        assert data["plexAuthEnabled"] == False

def test_startup_logs_warning_when_no_auth(caplog):
    """Startup logs warning when no auth methods enabled"""
    with patch("app.main.settings") as mock_settings:
        mock_settings.local_auth_enabled = False
        mock_settings.plex_auth_enabled = False

        from app.main import validate_auth_configuration

        with caplog.at_level(logging.WARNING):
            validate_auth_configuration()

        assert "No authentication methods enabled" in caplog.text

def test_startup_no_warning_when_auth_enabled(caplog):
    """Startup does not warn when auth methods enabled"""
    with patch("app.main.settings") as mock_settings:
        mock_settings.local_auth_enabled = True
        mock_settings.plex_auth_enabled = False

        from app.main import validate_auth_configuration

        with caplog.at_level(logging.WARNING):
            validate_auth_configuration()

        assert "No authentication methods enabled" not in caplog.text
```

### Backward Compatibility

**Important**: This is a breaking change for existing deployments.

Before this change:
- Local auth worked by default with hardcoded credentials

After this change:
- Local auth requires `LOCAL_AUTH_ENABLED=true`
- Without it, `/api/auth/token` returns 404

**Recommendation**: Document this clearly in release notes and provide migration guide.

### References

- [Source: backend/app/routers/auth.py] - Existing auth endpoint
- [Source: backend/app/config.py] - Settings pattern
- [Source: backend/app/main.py] - App startup
- [Source: _bmad-output/project-context.md] - Project conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - Implementation completed without issues

### Completion Notes List

- **Task 1**: Added `local_auth_enabled` and `plex_auth_enabled` boolean settings to Settings class with defaults of False for opt-in security
- **Task 2**: Updated `/api/auth/token` endpoint to check `local_auth_enabled` flag and return 404 when disabled
- **Task 3**: Added `validate_auth_configuration()` startup function with lifespan context manager that logs warning when no auth methods enabled
- **Task 4**: Added new `/api/auth/config` GET endpoint returning `AuthConfigResponse` with `localAuthEnabled` and `plexAuthEnabled` flags
- **Task 5**: Updated both `backend/.env.example` and root `.env.example` with comprehensive authentication settings documentation
- **Task 6**: Wrote 23 new/updated tests covering all acceptance criteria. Refactored existing tests to work with feature flags using mock patches.

### Change Log

- 2026-01-04: Implemented feature-flagged local authentication (Story 8.5)
  - Added LOCAL_AUTH_ENABLED and PLEX_AUTH_ENABLED environment variables
  - Added /api/auth/config endpoint for frontend to query available auth methods
  - Added startup validation with warning when no auth enabled
  - All 279 backend tests pass, all 513 frontend tests pass

### File List

- backend/app/config.py (modified - added auth feature flags)
- backend/app/routers/auth.py (modified - added /config endpoint and feature flag check)
- backend/app/main.py (modified - added lifespan handler with startup validation)
- backend/app/models/auth.py (modified - added AuthConfigResponse model)
- backend/.env.example (modified - added auth settings documentation)
- .env.example (modified - added auth settings documentation)
- backend/tests/routers/test_auth.py (modified - added feature flag tests, refactored existing tests)
- backend/tests/test_config.py (modified - added auth settings tests)
- backend/tests/test_main.py (modified - patched settings for integration tests)
