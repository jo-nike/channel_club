# Story 8.3: Plex User Role Assignment

Status: review

## Story

As an admin,
I want to configure how Plex users are assigned roles,
so that I can control access levels automatically.

## Acceptance Criteria

1. **Default Viewer Role**: When `PLEX_DEFAULT_ROLE=viewer` (or not set), new Plex users are assigned "viewer" role
2. **Default Admin Role**: When `PLEX_DEFAULT_ROLE=admin`, new Plex users are assigned "admin" role
3. **Server Owner Override**: When Plex user is the server owner (matching `PLEX_SERVER_TOKEN` owner), they are always assigned "admin" role regardless of default

## Tasks / Subtasks

- [x] Task 1: Implement server owner detection (AC: #3)
  - [x] Add function to determine Plex server owner from `PLEX_SERVER_TOKEN`
  - [x] Cache server owner info at startup (or on first Plex auth)
  - [x] Compare authenticated user's Plex ID with server owner's ID
- [x] Task 2: Update role assignment logic (AC: #1, #2, #3)
  - [x] Modify `/api/auth/plex` endpoint to check if user is server owner
  - [x] If server owner, assign "admin" role regardless of `PLEX_DEFAULT_ROLE`
  - [x] Otherwise, use `PLEX_DEFAULT_ROLE` (default: "viewer")
- [x] Task 3: Add Plex admin users config (optional enhancement)
  - [x] Add `plex_admin_users: list[str] = []` config for specific admin usernames
  - [x] Check if user's Plex username is in admin list
- [x] Task 4: Write tests (AC: #1-3)
  - [x] Test default viewer role assignment
  - [x] Test configured admin role assignment
  - [x] Test server owner always gets admin
  - [x] Test non-owner with admin default gets admin

## Dev Notes

### Architecture Compliance

- **Service layer pattern**: Role determination logic in `services/plex.py`
- **Config pattern**: Settings via pydantic-settings
- **Caching pattern**: Cache server owner info to avoid repeated API calls

### Technical Implementation

**Server Owner Detection:**
The server owner can be determined by checking the Plex API with the server token.
Call `GET https://plex.tv/users/account` with the `PLEX_SERVER_TOKEN` to get the owner's Plex ID.

**Plex Service Updates** (`backend/app/services/plex.py`):
```python
from functools import lru_cache

@lru_cache(maxsize=1)
async def get_server_owner_id() -> str | None:
    """Get the Plex ID of the server owner from PLEX_SERVER_TOKEN."""
    if not settings.plex_server_token:
        return None

    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://plex.tv/users/account",
            headers={**PLEX_API_HEADERS, "X-Plex-Token": settings.plex_server_token}
        )
        if response.status_code != 200:
            return None

        data = response.json()
        return str(data.get("id"))

async def determine_role(plex_user: PlexUser) -> str:
    """Determine the role for a Plex user.

    Args:
        plex_user: The authenticated Plex user

    Returns:
        "admin" if user is server owner, otherwise PLEX_DEFAULT_ROLE
    """
    # Check if user is the server owner
    owner_id = await get_server_owner_id()
    if owner_id and plex_user.id == owner_id:
        return "admin"

    # Check if user is in admin list (optional)
    if settings.plex_admin_users and plex_user.username in settings.plex_admin_users:
        return "admin"

    # Return default role
    return settings.plex_default_role
```

**Config Additions** (`backend/app/config.py`):
```python
class Settings(BaseSettings):
    # ... existing settings ...

    # Plex Authentication
    plex_auth_enabled: bool = False
    plex_server_token: str | None = None
    plex_server_machine_id: str | None = None
    plex_default_role: str = "viewer"
    plex_admin_users: list[str] = []  # Optional list of usernames who get admin role
```

**Auth Router Update** (`backend/app/routers/auth.py`):
```python
from app.services.plex import validate_plex_token, check_server_access, determine_role

@router.post("/plex", response_model=TokenResponse)
async def login_with_plex(request: PlexAuthRequest) -> TokenResponse:
    """Authenticate using Plex token."""
    if not settings.plex_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    try:
        plex_user = await validate_plex_token(request.auth_token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Plex token"
        )

    has_access = await check_server_access(request.auth_token)
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access to Plex server"
        )

    # Determine role based on configuration and ownership
    role = await determine_role(plex_user)

    token = create_access_token({
        "sub": plex_user.username,
        "role": role,
        "plex_id": plex_user.id
    })
    return TokenResponse(access_token=token, role=role)
```

### Edge Cases

1. **No server token configured**: If `PLEX_SERVER_TOKEN` is not set, server owner detection is skipped
2. **Invalid server token**: If token is invalid, owner detection fails gracefully (returns None)
3. **Role validation**: Only accept "admin" or "viewer" for `PLEX_DEFAULT_ROLE`

### Dependencies

- Story 8.1 must be completed first (Plex backend service with basic auth)

### Project Structure Notes

Modified files:
- `backend/app/config.py` (modify - add plex_admin_users)
- `backend/app/services/plex.py` (modify - add get_server_owner_id, determine_role)
- `backend/app/routers/auth.py` (modify - use determine_role)
- `backend/tests/services/test_plex.py` (modify - add role tests)

### Testing Requirements

```python
import pytest
from unittest.mock import AsyncMock, patch
from app.services.plex import determine_role, PlexUser

@pytest.mark.asyncio
async def test_default_viewer_role():
    """Users get viewer role by default"""
    user = PlexUser(id="123", username="testuser", email="test@test.com")

    with patch("app.services.plex.get_server_owner_id", return_value="999"):
        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_default_role = "viewer"
            mock_settings.plex_admin_users = []
            role = await determine_role(user)
            assert role == "viewer"

@pytest.mark.asyncio
async def test_configured_admin_role():
    """Users get admin role when PLEX_DEFAULT_ROLE=admin"""
    user = PlexUser(id="123", username="testuser", email="test@test.com")

    with patch("app.services.plex.get_server_owner_id", return_value="999"):
        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_default_role = "admin"
            mock_settings.plex_admin_users = []
            role = await determine_role(user)
            assert role == "admin"

@pytest.mark.asyncio
async def test_server_owner_always_admin():
    """Server owner gets admin role regardless of default"""
    owner_id = "123"
    user = PlexUser(id=owner_id, username="serverowner", email="owner@test.com")

    with patch("app.services.plex.get_server_owner_id", return_value=owner_id):
        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_default_role = "viewer"  # Default is viewer
            mock_settings.plex_admin_users = []
            role = await determine_role(user)
            assert role == "admin"  # But owner gets admin

@pytest.mark.asyncio
async def test_admin_users_list():
    """Users in plex_admin_users list get admin role"""
    user = PlexUser(id="456", username="vipuser", email="vip@test.com")

    with patch("app.services.plex.get_server_owner_id", return_value="999"):
        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_default_role = "viewer"
            mock_settings.plex_admin_users = ["vipuser", "anotheradmin"]
            role = await determine_role(user)
            assert role == "admin"
```

### Environment Variables

Update `.env.example`:
```bash
# Plex Authentication
PLEX_AUTH_ENABLED=false
PLEX_SERVER_TOKEN=            # Your Plex server token (for owner detection)
PLEX_SERVER_MACHINE_ID=       # Your Plex server machine identifier
PLEX_DEFAULT_ROLE=viewer      # Default role for Plex users (viewer or admin)
PLEX_ADMIN_USERS=             # Comma-separated list of Plex usernames who get admin role
```

### References

- [Source: backend/app/services/plex.py] - Plex service from Story 8.1
- [Source: backend/app/routers/auth.py] - Auth endpoint
- [Source: backend/app/config.py] - Settings pattern
- [Source: _bmad-output/project-context.md] - Project conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - No debug issues encountered

### Completion Notes List

- Implemented `get_server_owner_id()` function in `services/plex.py` with custom caching mechanism to avoid repeated API calls to Plex
- Implemented `determine_role()` function that checks: 1) server owner → admin, 2) plex_admin_users list → admin, 3) default role
- Added `plex_admin_users: list[str] = []` config setting for optional admin username list
- Updated `/api/auth/plex` endpoint to use `determine_role()` for dynamic role assignment
- Added comprehensive tests covering all acceptance criteria scenarios
- All 39 Plex and auth tests pass

### File List

- `backend/app/config.py` (modified) - Added plex_admin_users config
- `backend/app/services/plex.py` (modified) - Added get_server_owner_id(), determine_role() functions
- `backend/app/routers/auth.py` (modified) - Updated to use determine_role()
- `backend/tests/services/test_plex.py` (modified) - Added TestGetServerOwnerId, TestDetermineRole test classes
- `backend/tests/test_config.py` (modified) - Added test for plex_admin_users config

### Change Log

- 2026-01-04: Implemented Plex user role assignment with server owner detection and admin users list support
