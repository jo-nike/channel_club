# Story 9.1: Backend Logging Infrastructure

Status: review

## Story

As an operator,
I want structured logging throughout the backend,
So that I can monitor application health and debug issues.

## Acceptance Criteria

1. **Given** the backend starts **When** logging is initialized **Then** loguru is configured with level from `LOG_LEVEL` env var **And** output format respects `LOG_FORMAT` (json or pretty) **And** startup message is logged

2. **Given** `LOG_FORMAT=json` **When** any log message is written **Then** output is valid JSON with timestamp, level, message, and context

3. **Given** `LOG_FORMAT=pretty` (default) **When** any log message is written **Then** output is human-readable with colors and formatting

4. **Given** loguru is configured **When** it intercepts standard library logging **Then** FastAPI/uvicorn logs are also formatted consistently

## Tasks / Subtasks

- [x] Task 1: Add loguru dependency (AC: #1)
  - [x] Add `loguru>=0.7.0` to backend dependencies via uv
  - [x] Verify installation with `uv sync`

- [x] Task 2: Add logging environment variables to config (AC: #1, #2, #3)
  - [x] Add `log_level: str = "INFO"` to Settings class
  - [x] Add `log_format: str = "pretty"` to Settings class (values: "json" or "pretty")
  - [x] Document in .env.example

- [x] Task 3: Create logging configuration module (AC: #1, #2, #3, #4)
  - [x] Create `backend/app/logging_config.py`
  - [x] Implement `configure_logging()` function that:
    - Removes default loguru handler
    - Adds new handler with format based on `LOG_FORMAT`
    - Sets level from `LOG_LEVEL`
  - [x] Implement JSON serializer for structured logs when `LOG_FORMAT=json`
  - [x] Implement pretty format with colors when `LOG_FORMAT=pretty`
  - [x] Add standard library logging interception for uvicorn/FastAPI

- [x] Task 4: Integrate logging in main.py startup (AC: #1)
  - [x] Import and call `configure_logging()` in lifespan handler
  - [x] Log startup message with app version and configuration
  - [x] Replace `logging.getLogger(__name__)` with loguru logger

- [x] Task 5: Write tests for logging configuration
  - [x] Test JSON format produces valid JSON output
  - [x] Test pretty format includes colors (when terminal supports)
  - [x] Test log level filtering works correctly
  - [x] Test standard library interception works

## Dev Notes

### Architecture Compliance

- Create new file: `backend/app/logging_config.py` for centralized logging setup
- Follow existing pattern: module files are **snake_case**
- Use `async def` for any async initialization if needed
- Keep logging configuration separate from app config (single responsibility)

### Library/Framework Requirements

- **loguru** version 0.7.0+ (latest stable, Python 3.13 compatible)
- loguru provides:
  - `serialize=True` for JSON output
  - `colorize=True` for colored terminal output
  - Standard library interception via `InterceptHandler`
- Reference: [loguru documentation](https://loguru.readthedocs.io/)

### File Structure Requirements

```
backend/
├── app/
│   ├── logging_config.py    # NEW - logging configuration
│   ├── config.py            # MODIFY - add LOG_LEVEL, LOG_FORMAT
│   ├── main.py              # MODIFY - call configure_logging()
```

### Implementation Patterns

**JSON Format Pattern:**
```python
from loguru import logger

def json_sink(message):
    # loguru's serialize=True handles this automatically
    print(message, end="")

logger.add(json_sink, serialize=True, level=settings.log_level)
```

**Pretty Format Pattern:**
```python
logger.add(
    sys.stderr,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    colorize=True,
    level=settings.log_level
)
```

**Standard Library Interception:**
```python
import logging

class InterceptHandler(logging.Handler):
    def emit(self, record):
        # Get corresponding loguru level
        level = logger.level(record.levelname).name
        logger.opt(depth=6, exception=record.exc_info).log(level, record.getMessage())

logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)
```

### Testing Strategy

- Use pytest's `capsys` or `capfd` to capture log output
- Test JSON format with `json.loads()` validation
- Mock terminal capabilities for color testing

### Environment Variables

Add to `.env.example`:
```bash
# Logging Configuration
LOG_LEVEL=INFO       # DEBUG, INFO, WARNING, ERROR
LOG_FORMAT=pretty    # json or pretty
```

### References

- [Source: _bmad-output/project-context.md#Python/FastAPI Rules]
- [Source: epics.md#Epic 9 - Story 9.1]
- [loguru GitHub](https://github.com/Delgan/loguru)
- [loguru PyPI](https://pypi.org/project/loguru/)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - No debugging issues encountered

### Completion Notes List

- Implemented loguru-based structured logging for the backend
- Added LOG_LEVEL and LOG_FORMAT environment variables with sensible defaults (INFO/pretty)
- Created centralized logging_config.py module with configure_logging() function
- Integrated logging into FastAPI lifespan handler with startup/shutdown messages
- Replaced standard library logger with loguru throughout main.py
- Created InterceptHandler class to route uvicorn/FastAPI logs through loguru
- Added comprehensive test suite (17 tests) covering JSON format, pretty format, log level filtering, and standard library interception
- Updated existing auth tests to work with loguru instead of caplog fixture
- All 333 tests pass, linter clean

### File List

- backend/pyproject.toml (MODIFIED - added loguru>=0.7.0 dependency)
- backend/app/config.py (MODIFIED - added log_level and log_format settings)
- backend/app/logging_config.py (NEW - logging configuration module)
- backend/app/main.py (MODIFIED - integrated loguru logging, replaced standard library logger)
- backend/.env.example (MODIFIED - documented LOG_LEVEL and LOG_FORMAT)
- backend/tests/test_logging_config.py (NEW - 17 tests for logging configuration)
- backend/tests/routers/test_auth.py (MODIFIED - updated 3 tests to work with loguru)

## Change Log

- 2026-01-04: Implemented backend logging infrastructure with loguru (Story 9.1)
