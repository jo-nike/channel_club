# Story 1.2: JWT Authentication Backend

Status: review

## Story

As a user,
I want to authenticate with my credentials,
So that I can access the application securely.

## Acceptance Criteria

1. **Given** valid admin credentials (from env vars)
   **When** I POST to `/api/auth/token` with username/password
   **Then** I receive a JWT token with 7-day expiration containing role claim
   **And** the response includes `{"access_token": "...", "token_type": "bearer", "role": "admin"}`

2. **Given** valid viewer credentials
   **When** I POST to `/api/auth/token`
   **Then** I receive a JWT with role="viewer"
   **And** the response format matches admin response

3. **Given** invalid credentials
   **When** I POST to `/api/auth/token`
   **Then** I receive 401 Unauthorized with `{"detail": "Invalid credentials"}`

4. **Given** a valid JWT token
   **When** I include it in Authorization header as "Bearer {token}"
   **Then** protected endpoints accept the request

5. **Given** an expired or invalid JWT token
   **When** I include it in Authorization header
   **Then** I receive 401 Unauthorized

## Tasks / Subtasks

- [x] Task 1: Create Pydantic Models (AC: #1, #2)
  - [x] Create backend/app/models/auth.py
  - [x] Define LoginRequest model (username: str, password: str)
  - [x] Define TokenResponse model (access_token: str, token_type: str, role: str)
  - [x] Define TokenPayload model (sub: str, role: str, exp: datetime)

- [x] Task 2: Implement JWT Token Service (AC: #1, #2, #4, #5)
  - [x] Add JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRATION_DAYS to config.py
  - [x] Create function `create_access_token(data: dict) -> str`
  - [x] Create function `verify_token(token: str) -> TokenPayload`
  - [x] Use python-jose for JWT encoding/decoding
  - [x] Set expiration to 7 days

- [x] Task 3: Implement Auth Router (AC: #1, #2, #3)
  - [x] Create backend/app/routers/auth.py
  - [x] Implement POST /api/auth/token endpoint
  - [x] Read ADMIN_USERNAME, ADMIN_PASSWORD, VIEWER_USERNAME, VIEWER_PASSWORD from config
  - [x] Validate credentials against hardcoded values
  - [x] Return appropriate JWT with role claim
  - [x] Return 401 for invalid credentials

- [x] Task 4: Implement Auth Dependency (AC: #4, #5)
  - [x] Create `get_current_user` dependency function
  - [x] Extract token from Authorization header
  - [x] Verify token and return TokenPayload
  - [x] Raise HTTPException 401 for invalid/expired tokens
  - [x] Create `require_admin` dependency that checks role="admin"

- [x] Task 5: Register Router and Test
  - [x] Register auth router in main.py with prefix "/api/auth"
  - [x] Test all endpoints manually with curl/httpie
  - [x] Verify token expiration is 7 days
  - [x] Verify role claim is included in token

## Dev Notes

### Architecture Compliance

**API Endpoint:** POST /api/auth/token
- No authentication required for this endpoint
- Returns JWT token for subsequent authenticated requests

**JWT Configuration:**
- Algorithm: HS256
- Expiration: 7 days
- Storage: Stateless (no server-side session)
- Secret: From JWT_SECRET environment variable

### Pydantic Models Structure

```python
# backend/app/models/auth.py
from pydantic import BaseModel
from datetime import datetime

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str

class TokenPayload(BaseModel):
    sub: str  # username
    role: str  # "admin" or "viewer"
    exp: datetime
```

### Auth Router Implementation

```python
# backend/app/routers/auth.py
from fastapi import APIRouter, HTTPException, status
from app.models.auth import LoginRequest, TokenResponse
from app.config import settings
from datetime import datetime, timedelta, timezone
from jose import jwt

router = APIRouter(prefix="/auth", tags=["auth"])

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=7)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm="HS256")

@router.post("/token", response_model=TokenResponse)
async def login(request: LoginRequest):
    # Check admin credentials
    if request.username == settings.ADMIN_USERNAME and request.password == settings.ADMIN_PASSWORD:
        role = "admin"
    # Check viewer credentials
    elif request.username == settings.VIEWER_USERNAME and request.password == settings.VIEWER_PASSWORD:
        role = "viewer"
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )

    token = create_access_token({"sub": request.username, "role": role})
    return TokenResponse(access_token=token, role=role)
```

### Auth Dependency Implementation

```python
# backend/app/routers/auth.py (continued)
from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError

security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> TokenPayload:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        return TokenPayload(**payload)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )

async def require_admin(
    current_user: TokenPayload = Depends(get_current_user)
) -> TokenPayload:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user
```

### Config Settings

```python
# backend/app/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Auth
    JWT_SECRET: str = "change-this-in-production"
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"
    VIEWER_USERNAME: str = "viewer"
    VIEWER_PASSWORD: str = "viewer"

    # Dispatcharr
    DISPATCHARR_URL: str = "http://10.8.0.2:9191"

    class Config:
        env_file = ".env"

settings = Settings()
```

### Project Structure Notes

Files to create/modify:
- `backend/app/models/auth.py` - NEW
- `backend/app/routers/auth.py` - NEW
- `backend/app/config.py` - MODIFY (add auth settings)
- `backend/app/main.py` - MODIFY (register auth router)

### Naming Conventions

- Python files: snake_case (auth.py, token_response.py)
- Classes: PascalCase (TokenPayload, LoginRequest)
- Functions: snake_case (create_access_token, verify_token)
- JSON response fields: camelCase (access_token → accessToken in frontend)

**IMPORTANT:** Backend uses snake_case internally, but Pydantic models should use camelCase aliases for JSON serialization to match frontend expectations:

```python
class TokenResponse(BaseModel):
    access_token: str = Field(alias="accessToken")
    token_type: str = Field(default="bearer", alias="tokenType")
    role: str

    class Config:
        populate_by_name = True
```

### Anti-Patterns to Avoid

- ❌ Do NOT store tokens server-side (stateless JWT)
- ❌ Do NOT use hardcoded secret in production
- ❌ Do NOT return password in any response
- ❌ Do NOT use async for simple operations that don't need it
- ❌ Do NOT skip token expiration validation

### References

- [Source: _bmad-output/architecture.md#Authentication-&-Security]
- [Source: _bmad-output/architecture.md#API-Boundaries]
- [Source: _bmad-output/prd.md#Authentication-&-Authorization]
- [Source: _bmad-output/project-context.md#Python/FastAPI-Rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation proceeded smoothly with no blocking issues.

### Completion Notes List

- Implemented JWT authentication following red-green-refactor TDD cycle
- All Pydantic models use camelCase aliases for JSON serialization per project standards
- JWT service uses HS256 algorithm with 7-day expiration
- Auth router at `/api/auth/token` handles admin and viewer credential validation
- Auth dependencies (`get_current_user`, `require_admin`) provide protected route support
- Fixed Pydantic deprecation warning in config.py (class Config → model_config)
- 30 unit/integration tests pass covering all acceptance criteria

### File List

**New Files:**
- backend/app/models/auth.py
- backend/app/models/auth_test.py
- backend/app/services/auth.py
- backend/app/services/auth_test.py
- backend/app/routers/auth_deps.py
- backend/app/routers/auth_deps_test.py
- backend/app/routers/auth_test.py
- backend/app/main_test.py

**Modified Files:**
- backend/app/routers/auth.py (replaced placeholder)
- backend/app/config.py (updated to use SettingsConfigDict)
- backend/app/main.py (registered auth router)

## Change Log

- 2025-12-23: Implemented JWT authentication backend (Story 1.2) - all 5 tasks complete with 30 passing tests

