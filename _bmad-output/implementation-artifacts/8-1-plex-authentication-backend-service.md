# Story 8.1: Plex Authentication Backend Service

Status: review

## Story

As a developer,
I want a Plex authentication service in the backend,
so that users can authenticate via their Plex accounts.

## Acceptance Criteria

1. **Plex Auth Enabled**: When `PLEX_AUTH_ENABLED=true`, POST `/api/auth/plex` accepts `{authToken: "..."}` and validates against Plex API
2. **Plex Token Validation**: Backend validates token via Plex API `https://plex.tv/users/account`
3. **Server Access Check**: Backend verifies user has access to configured Plex server using `PLEX_SERVER_TOKEN` and `PLEX_SERVER_MACHINE_ID`
4. **JWT Response**: On success, returns JWT with role claim (same format as existing `/api/auth/token`)
5. **Auth Disabled Response**: When `PLEX_AUTH_ENABLED=false` or not set, return 404 Not Found
6. **No Server Access Response**: When valid Plex token but no server access, return 403 Forbidden with "No access to Plex server"
7. **Invalid Token Response**: When invalid or expired Plex token, return 401 Unauthorized

## Tasks / Subtasks

- [x] Task 1: Add Plex configuration to Settings (AC: #1, #5)
  - [x] Add `plex_auth_enabled: bool = False` to Settings class
  - [x] Add `plex_server_token: str | None = None` for admin's server token
  - [x] Add `plex_server_machine_id: str | None = None` for server identification
  - [x] Add `plex_default_role: str = "viewer"` for default role assignment
- [x] Task 2: Create Plex service layer (AC: #2, #3)
  - [x] Create `backend/app/services/plex.py`
  - [x] Implement `validate_plex_token(auth_token: str) -> PlexUser` - calls `https://plex.tv/users/account`
  - [x] Implement `check_server_access(plex_user: PlexUser) -> bool` - checks if user has access to configured server
  - [x] Add httpx for async HTTP calls to Plex API
- [x] Task 3: Create Plex auth models (AC: #4)
  - [x] Create `backend/app/models/plex.py`
  - [x] Define `PlexAuthRequest` with `auth_token: str` field (camelCase alias: authToken)
  - [x] Define `PlexUser` internal model for API response data
- [x] Task 4: Create Plex auth endpoint (AC: #1-7)
  - [x] Add `/api/auth/plex` POST endpoint to `backend/app/routers/auth.py`
  - [x] Check `plex_auth_enabled` first, return 404 if false
  - [x] Validate token via plex service
  - [x] Check server access
  - [x] Return JWT with role on success
- [x] Task 5: Update .env.example with Plex variables
  - [x] Add PLEX_AUTH_ENABLED, PLEX_SERVER_TOKEN, PLEX_SERVER_MACHINE_ID, PLEX_DEFAULT_ROLE documentation
- [x] Task 6: Write tests (AC: #1-7)
  - [x] Test endpoint returns 404 when PLEX_AUTH_ENABLED=false
  - [x] Test endpoint validates Plex token (mock Plex API)
  - [x] Test endpoint returns 403 when no server access
  - [x] Test endpoint returns 401 for invalid token
  - [x] Test endpoint returns JWT for valid token with server access

## Dev Notes

### Architecture Compliance

- **Service layer pattern**: All Plex API calls go through `services/plex.py`
- **Router pattern**: Auth endpoints in `routers/auth.py`
- **Config pattern**: Settings via pydantic-settings in `config.py`
- **Model pattern**: Pydantic models with camelCase aliases for JSON
- **Async pattern**: Use `async def` for all handlers and httpx for HTTP calls

### Technical Implementation

**Plex API Reference:**
- Account endpoint: `GET https://plex.tv/users/account` with `X-Plex-Token` header
- Returns XML by default, request JSON with `Accept: application/json`
- Response includes `id`, `username`, `email`, `thumb` (avatar URL)

**Server Access Verification:**
The Plex API `GET https://plex.tv/api/v2/resources` returns all servers the user has access to.
Check if any server's `clientIdentifier` matches `PLEX_SERVER_MACHINE_ID`.

**Config additions** (`backend/app/config.py`):
```python
class Settings(BaseSettings):
    # ... existing settings ...

    # Plex Authentication
    plex_auth_enabled: bool = False
    plex_server_token: str | None = None
    plex_server_machine_id: str | None = None
    plex_default_role: str = "viewer"
```

**Plex Service** (`backend/app/services/plex.py`):
```python
import httpx
from app.config import settings
from app.models.plex import PlexUser

PLEX_API_HEADERS = {
    "Accept": "application/json",
    "X-Plex-Product": "IPTV Viewer",
    "X-Plex-Client-Identifier": "iptv-viewer-2",
}

async def validate_plex_token(auth_token: str) -> PlexUser:
    """Validate Plex auth token and return user info."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://plex.tv/users/account",
            headers={**PLEX_API_HEADERS, "X-Plex-Token": auth_token}
        )
        if response.status_code != 200:
            raise ValueError("Invalid Plex token")
        data = response.json()
        return PlexUser(
            id=str(data["id"]),
            username=data["username"],
            email=data.get("email", ""),
            thumb=data.get("thumb")
        )

async def check_server_access(auth_token: str) -> bool:
    """Check if user has access to configured Plex server."""
    if not settings.plex_server_machine_id:
        return True  # No server configured, allow all Plex users

    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://plex.tv/api/v2/resources",
            headers={**PLEX_API_HEADERS, "X-Plex-Token": auth_token},
            params={"includeHttps": 1}
        )
        if response.status_code != 200:
            return False

        resources = response.json()
        for resource in resources:
            if resource.get("clientIdentifier") == settings.plex_server_machine_id:
                return True
        return False
```

**Plex Models** (`backend/app/models/plex.py`):
```python
from pydantic import BaseModel, Field
from typing import Optional

class PlexAuthRequest(BaseModel):
    """Request body for Plex authentication."""
    auth_token: str = Field(alias="authToken")

    class Config:
        populate_by_name = True

class PlexUser(BaseModel):
    """Plex user information from API response."""
    id: str
    username: str
    email: str
    thumb: Optional[str] = None
```

**Auth Router Update** (`backend/app/routers/auth.py`):
```python
from app.config import settings
from app.models.plex import PlexAuthRequest
from app.services.plex import validate_plex_token, check_server_access

@router.post("/plex", response_model=TokenResponse)
async def login_with_plex(request: PlexAuthRequest) -> TokenResponse:
    """Authenticate using Plex token."""
    # Check if Plex auth is enabled
    if not settings.plex_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Validate Plex token
    try:
        plex_user = await validate_plex_token(request.auth_token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Plex token"
        )

    # Check server access
    has_access = await check_server_access(request.auth_token)
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access to Plex server"
        )

    # Create JWT with role
    role = settings.plex_default_role
    token = create_access_token({"sub": plex_user.username, "role": role, "plex_id": plex_user.id})
    return TokenResponse(access_token=token, role=role)
```

### Dependencies

Add to `pyproject.toml`:
```toml
dependencies = [
    # ... existing dependencies ...
    "httpx>=0.27.0",
]
```

### Project Structure Notes

New/modified files:
- `backend/app/config.py` (modify - add Plex settings)
- `backend/app/services/plex.py` (new)
- `backend/app/models/plex.py` (new)
- `backend/app/routers/auth.py` (modify - add /plex endpoint)
- `backend/.env.example` (modify - add Plex env vars)
- `backend/tests/services/test_plex.py` (new)
- `backend/tests/routers/test_auth_plex.py` (new)

### Testing Requirements

```python
import pytest
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_plex_auth_returns_404_when_disabled(client):
    """Plex endpoint returns 404 when PLEX_AUTH_ENABLED=false"""
    response = await client.post("/api/auth/plex", json={"authToken": "test-token"})
    assert response.status_code == 404

@pytest.mark.asyncio
async def test_plex_auth_returns_401_for_invalid_token(client_plex_enabled):
    """Plex endpoint returns 401 for invalid token"""
    with patch("app.services.plex.validate_plex_token", side_effect=ValueError()):
        response = await client_plex_enabled.post(
            "/api/auth/plex",
            json={"authToken": "invalid-token"}
        )
        assert response.status_code == 401

@pytest.mark.asyncio
async def test_plex_auth_returns_403_no_server_access(client_plex_enabled):
    """Plex endpoint returns 403 when user lacks server access"""
    mock_user = PlexUser(id="1", username="test", email="test@test.com")
    with patch("app.services.plex.validate_plex_token", return_value=mock_user):
        with patch("app.services.plex.check_server_access", return_value=False):
            response = await client_plex_enabled.post(
                "/api/auth/plex",
                json={"authToken": "valid-token"}
            )
            assert response.status_code == 403
            assert "No access to Plex server" in response.json()["detail"]

@pytest.mark.asyncio
async def test_plex_auth_returns_jwt_on_success(client_plex_enabled):
    """Plex endpoint returns JWT for valid token with server access"""
    mock_user = PlexUser(id="1", username="plexuser", email="test@test.com")
    with patch("app.services.plex.validate_plex_token", return_value=mock_user):
        with patch("app.services.plex.check_server_access", return_value=True):
            response = await client_plex_enabled.post(
                "/api/auth/plex",
                json={"authToken": "valid-token"}
            )
            assert response.status_code == 200
            data = response.json()
            assert "accessToken" in data
            assert data["role"] == "viewer"
```

### References

- [Source: backend/app/routers/auth.py] - Existing auth endpoint pattern
- [Source: backend/app/config.py] - Settings pattern
- [Source: backend/app/services/auth.py] - JWT token creation
- [Plex API Docs: https://github.com/Arcanemagus/plex-api/wiki/Plex.tv] - Plex.tv API reference
- [Source: _bmad-output/project-context.md] - Project conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation proceeded without issues.

### Completion Notes List

- Implemented Plex authentication backend service following red-green-refactor TDD cycle
- Added Plex configuration settings (plex_server_token, plex_server_machine_id, plex_default_role) to Settings class
- Created PlexAuthRequest and PlexUser Pydantic models with camelCase aliases
- Implemented plex.py service with validate_plex_token() and check_server_access() async functions
- Added /api/auth/plex POST endpoint with proper error handling (404, 401, 403)
- JWT includes plex_id claim for Plex user identification
- All 26 new tests pass (9 model, 8 service, 6 endpoint, 3 config)
- httpx was already in dependencies (v0.28.1)
- .env.example already had Plex variables from Story 8-5
- Fixed linting error (B904) for proper exception chaining

### File List

**New Files:**
- backend/app/models/plex.py
- backend/app/services/plex.py
- backend/tests/models/test_plex.py
- backend/tests/services/test_plex.py

**Modified Files:**
- backend/app/config.py (added plex_server_token, plex_server_machine_id, plex_default_role)
- backend/app/routers/auth.py (added /api/auth/plex endpoint)
- backend/tests/routers/test_auth.py (added TestPlexAuthEndpoint class)
- backend/tests/test_config.py (added tests for new Plex settings)

### Change Log

- 2026-01-04: Implemented Plex authentication backend service (Story 8.1)
