# Sprint Change Proposal: Comprehensive Logging

**Date:** 2026-01-04
**Prepared for:** Jon
**Status:** APPROVED
**Change Type:** Proactive Observability Enhancement
**Scope:** Minor-Moderate (Direct Implementation)

---

## Section 1: Issue Summary

**Problem Statement:**
The iptv_viewer2 application currently has minimal logging infrastructure. Backend uses Python's standard `logging` module with limited usage (only in `main.py`). Frontend uses scattered `console.log`/`console.error` statements with no structured approach. This creates blind spots for debugging production issues and monitoring application health.

**Discovery Context:**
Proactive decision to improve observability before issues occur in production.

**Evidence:**
- `backend/app/main.py`: Single `logger = logging.getLogger(__name__)` with one `logger.warning()` call
- `backend/app/services/dispatcharr.py`: Catches `httpx.HTTPError` but doesn't log it
- `frontend/src/hooks/useWebSocket.ts`: Uses raw `console.log`/`console.error`
- No request/response logging middleware
- No structured log format for machine parsing

---

## Section 2: Impact Analysis

### Epic Impact

| Epic | Impact Level | Notes |
|------|-------------|-------|
| Epic 1: Auth | Low | Add logging to login success/failure |
| Epic 2: Channels | Medium | Log Dispatcharr API calls, stream errors |
| Epic 3: WebSocket | Medium | Log connections, broadcasts, reconnects |
| Epic 4: UI | Low | Frontend logger for debug info |
| Epic 5: Docker | Low | Configure log output format |
| Epic 6: EPG | Low | Log EPG fetch/cache operations |
| Epic 7: ErsatzTV | Medium | Log M3U parsing, HLS proxy |
| Epic 8: Plex Auth | Low | Log Plex OAuth flow |

**No epics need modification** - this is additive enhancement.

### Artifact Impact

| Artifact | Changes Needed |
|----------|---------------|
| **PRD** | None (observability not in scope) |
| **Architecture** | Minor update: add logging to Implementation Patterns |
| **Epics/Stories** | New story needed for logging implementation |
| **Backend Code** | All 16 Python files need logging added |
| **Frontend Code** | New logger utility + updates to key files |
| **Docker** | Minor: ensure proper log collection |
| **pyproject.toml** | Add `loguru` dependency |

### Files Requiring Changes

**Backend (16 files):**
```
backend/app/main.py                          # Configure loguru, middleware
backend/app/config.py                        # Add LOG_LEVEL setting
backend/app/routers/auth.py                  # Login/logout logging
backend/app/routers/channels.py              # Channel operations
backend/app/routers/websocket.py             # Connection lifecycle
backend/app/routers/epg.py                   # EPG requests
backend/app/routers/ersatztv.py              # ErsatzTV operations
backend/app/routers/auth_deps.py             # Auth failures
backend/app/services/dispatcharr.py          # API calls
backend/app/services/channel_state.py        # State changes
backend/app/services/epg_service.py          # EPG cache
backend/app/services/plex.py                 # Plex auth flow
backend/app/services/ersatztv/m3u_parser.py  # M3U parsing
backend/app/services/ersatztv/xmltv_parser.py # XML parsing
backend/app/services/ersatztv/epg_service.py # ErsatzTV EPG
backend/app/services/ersatztv/hls_rewriter.py # HLS proxy
```

**Frontend (new + updates):**
```
frontend/src/lib/logger.ts                   # NEW: Logger utility
frontend/src/services/api.ts                 # Add request logging
frontend/src/hooks/useWebSocket.ts           # Structured WS logging
frontend/src/components/VideoPlayer.tsx      # Playback events
```

---

## Section 3: Recommended Approach

**Selected Path:** Direct Adjustment (add logging without changing existing functionality)

**Effort:** Medium
**Risk:** Low
**Timeline Impact:** None (additive, no blocking dependencies)

### Rationale:
1. No conflicts with existing code or architecture
2. Purely additive changes - no refactoring needed
3. Loguru is drop-in replacement for Python logging
4. Frontend logger is simple utility wrapper
5. Docker already uses stdout - just configure format

### Implementation Strategy:

**Backend - Loguru:**
- Intercept standard library `logging` to route through loguru
- JSON format in production, pretty-print in development
- Add request ID for tracing
- Log levels: DEBUG for dev, INFO for prod

**Frontend - Custom Logger:**
- Lightweight wrapper (`log.info()`, `log.warn()`, `log.error()`)
- Respects `VITE_LOG_LEVEL` env var
- Structured output for debugging
- No external dependencies

**Docker:**
- Logs go to stdout/stderr (uvicorn default)
- Docker captures automatically
- Ready for log aggregation (Loki, ELK) later

---

## Section 4: Detailed Change Proposals

### 4.1 New Dependency

```toml
# File: backend/pyproject.toml
# Section: dependencies

# ADD:
    "loguru>=0.7.2",
```

### 4.2 New Configuration Settings

```python
# File: backend/app/config.py
# ADD after line 9:

    log_level: str = "INFO"  # DEBUG, INFO, WARNING, ERROR
    log_format: str = "json"  # json (production) or pretty (development)
```

### 4.3 New Backend Logging Setup

```python
# File: backend/app/logging_config.py (NEW FILE)

"""Logging configuration using loguru."""
import sys
import logging
from loguru import logger
from app.config import settings


def setup_logging() -> None:
    """Configure loguru as the application logger."""
    # Remove default handler
    logger.remove()

    # Add configured handler
    if settings.log_format == "json":
        logger.add(
            sys.stdout,
            level=settings.log_level,
            format="{message}",
            serialize=True,  # JSON output
        )
    else:
        logger.add(
            sys.stdout,
            level=settings.log_level,
            format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        )

    # Intercept standard library logging
    class InterceptHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            level = logger.level(record.levelname).name
            logger.opt(depth=6, exception=record.exc_info).log(level, record.getMessage())

    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)
```

### 4.4 Main.py Updates

```python
# File: backend/app/main.py

# OLD (lines 1-2):
import logging
from contextlib import asynccontextmanager

# NEW:
from contextlib import asynccontextmanager
from loguru import logger
from app.logging_config import setup_logging

# DELETE line 17:
# logger = logging.getLogger(__name__)

# OLD (lines 29-34):
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    # Startup
    validate_auth_configuration()
    yield

# NEW:
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    # Startup
    setup_logging()
    logger.info("IPTV Viewer API starting up")
    validate_auth_configuration()
    yield
    # Shutdown
    logger.info("IPTV Viewer API shutting down")
```

### 4.5 Backend Service Logging Pattern

```python
# Pattern for all services - example: backend/app/services/dispatcharr.py

# ADD import:
from loguru import logger

# ADD logging to functions:
async def get_lineup() -> list[Channel]:
    try:
        logger.debug(f"Fetching lineup from {settings.dispatcharr_url}")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{settings.dispatcharr_url}/hdhr/lineup.json")
            response.raise_for_status()
            raw_channels = [DispatchrrChannel(**c) for c in response.json()]
            channels = [...]
            logger.info(f"Fetched {len(channels)} channels from Dispatcharr")
            return channels
    except httpx.HTTPError as e:
        logger.error(f"Dispatcharr unavailable: {e}")
        raise DispatchrrUnavailableError(f"Failed to fetch channels: {e}") from e
```

### 4.6 Backend Router Logging Pattern

```python
# Pattern for all routers - example: backend/app/routers/auth.py

# ADD import:
from loguru import logger

# ADD logging to endpoints:
@router.post("/token", response_model=TokenResponse)
async def login(request: LoginRequest) -> TokenResponse:
    logger.debug(f"Login attempt for user: {request.username}")
    # ... existing logic ...
    if user is None:
        logger.warning(f"Failed login attempt for user: {request.username}")
        raise HTTPException(...)
    logger.info(f"User logged in: {request.username} (role: {user.role})")
    return TokenResponse(...)
```

### 4.7 New Frontend Logger Utility

```typescript
// File: frontend/src/lib/logger.ts (NEW FILE)

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const currentLevel = (import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'info'
const levelThreshold = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= levelThreshold
}

function formatMessage(level: LogLevel, context: string, message: string): string {
  const timestamp = new Date().toISOString()
  return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}`
}

export const logger = {
  debug: (context: string, message: string, data?: unknown) => {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', context, message), data ?? '')
    }
  },
  info: (context: string, message: string, data?: unknown) => {
    if (shouldLog('info')) {
      console.info(formatMessage('info', context, message), data ?? '')
    }
  },
  warn: (context: string, message: string, data?: unknown) => {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', context, message), data ?? '')
    }
  },
  error: (context: string, message: string, error?: unknown) => {
    if (shouldLog('error')) {
      console.error(formatMessage('error', context, message), error ?? '')
    }
  },
}
```

### 4.8 Frontend Usage Pattern

```typescript
// Pattern for frontend files - example: frontend/src/services/api.ts

// ADD import:
import { logger } from '@/lib/logger'

// ADD logging to functions:
export async function login(credentials: LoginRequest): Promise<TokenResponse> {
  logger.debug('api', `Login attempt for user: ${credentials.username}`)
  const response = await fetch(...)
  if (!response.ok) {
    logger.warn('api', `Login failed for user: ${credentials.username}`, error)
    throw new Error(...)
  }
  logger.info('api', `Login successful for user: ${credentials.username}`)
  return response.json()
}
```

---

## Section 5: Implementation Handoff

### Change Scope Classification: Minor-Moderate

**Route to:** Development team for direct implementation

### Implementation Order

1. Add `loguru` dependency to `pyproject.toml`
2. Create `backend/app/logging_config.py`
3. Update `backend/app/config.py` with log settings
4. Update `backend/app/main.py` with loguru setup
5. Add logging to all backend services (8 files)
6. Add logging to all backend routers (6 files)
7. Create `frontend/src/lib/logger.ts`
8. Update `frontend/src/services/api.ts`
9. Update `frontend/src/hooks/useWebSocket.ts`
10. Update `frontend/src/services/ersatztvApi.ts`
11. Test locally with `LOG_FORMAT=pretty LOG_LEVEL=DEBUG`
12. Test Docker build and verify JSON log output

### New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Backend log level (DEBUG, INFO, WARNING, ERROR) |
| `LOG_FORMAT` | `json` | Backend format (json for prod, pretty for dev) |
| `VITE_LOG_LEVEL` | `info` | Frontend log level (debug, info, warn, error) |

### Success Criteria

- [ ] All backend requests logged (method, path, status)
- [ ] All errors logged with context
- [ ] WebSocket connections/disconnections logged
- [ ] Channel changes logged
- [ ] Frontend API calls logged in debug mode
- [ ] Docker logs show structured JSON output
- [ ] No raw `console.log` in production frontend code

---

## Approval Record

**Approved by:** Jon
**Approval Date:** 2026-01-04
**Implementation Target:** Direct development

---

## Architecture Update Required

Add to `_bmad-output/architecture.md` under "Implementation Patterns":

```markdown
### Logging Patterns

**Backend (loguru):**
- Import: `from loguru import logger`
- Levels: DEBUG for verbose, INFO for normal ops, WARNING for recoverable issues, ERROR for failures
- Format: JSON in production, pretty-print in development
- Always include context: user, channel_id, operation type

**Frontend (custom logger):**
- Import: `import { logger } from '@/lib/logger'`
- Usage: `logger.info('context', 'message', optionalData)`
- Contexts: 'api', 'websocket', 'player', 'auth', 'ersatztv'
```
