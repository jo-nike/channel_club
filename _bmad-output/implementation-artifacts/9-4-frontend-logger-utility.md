# Story 9.4: Frontend Logger Utility

Status: review

## Story

As a developer,
I want a structured logging utility for the frontend,
So that I can debug issues consistently.

## Acceptance Criteria

1. **Given** the logger utility is imported **When** I call `logger.info('context', 'message')` **Then** output includes timestamp, level, context, and message

2. **Given** `VITE_LOG_LEVEL=debug` **When** any log call is made **Then** all levels (debug, info, warn, error) are output

3. **Given** `VITE_LOG_LEVEL=error` **When** debug/info/warn calls are made **Then** they are suppressed (only errors shown)

4. **Given** the production build **When** logger is used **Then** no performance impact from suppressed log calls

## Tasks / Subtasks

- [x] Task 1: Create logger utility module (AC: #1, #4)
  - [x] Create `frontend/src/lib/logger.ts`
  - [x] Define LogLevel type: 'debug' | 'info' | 'warn' | 'error'
  - [x] Create logger object with methods: debug, info, warn, error
  - [x] Each method accepts (context: string, message: string, ...data: unknown[])
  - [x] Format output with timestamp, level, and context
  - [x] Export named `logger` constant

- [x] Task 2: Implement log level filtering (AC: #2, #3)
  - [x] Read `VITE_LOG_LEVEL` from import.meta.env
  - [x] Default to 'warn' for production, 'debug' for development
  - [x] Create level priority: debug=0, info=1, warn=2, error=3
  - [x] Filter logs below configured level
  - [x] Early-return for suppressed logs (no string formatting overhead)

- [x] Task 3: Implement structured output format (AC: #1)
  - [x] Timestamp format: ISO 8601 or HH:mm:ss.SSS for brevity
  - [x] Level indicator with color support
  - [x] Context in brackets: [Auth], [WebSocket], [API]
  - [x] Use console methods: console.debug, console.info, console.warn, console.error
  - [x] Support additional data arguments for object inspection

- [x] Task 4: Add environment variable to configuration (AC: #2, #3)
  - [x] Add `VITE_LOG_LEVEL` to `.env.example`
  - [x] Document valid values in comments
  - [x] Set appropriate defaults for dev vs prod

- [x] Task 5: Write tests for logger utility
  - [x] Test all log levels output correctly
  - [x] Test level filtering works
  - [x] Test format includes required fields
  - [x] Test suppressed logs don't format strings (performance)

## Dev Notes

### Architecture Compliance

- Create new file: `frontend/src/lib/logger.ts`
- Follow existing pattern: lib files in `frontend/src/lib/`
- Use named exports: `export const logger = { ... }`
- Follow TypeScript strict mode requirements

### File Structure Requirements

```
frontend/src/lib/
├── utils.ts       # Existing utility file
└── logger.ts      # NEW - logger utility
```

### Implementation Pattern

```typescript
// frontend/src/lib/logger.ts

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const getConfiguredLevel = (): LogLevel => {
  const level = import.meta.env.VITE_LOG_LEVEL as LogLevel | undefined
  if (level && level in LEVELS) return level
  return import.meta.env.DEV ? 'debug' : 'warn'
}

const configuredLevel = getConfiguredLevel()

const shouldLog = (level: LogLevel): boolean => {
  return LEVELS[level] >= LEVELS[configuredLevel]
}

const formatTimestamp = (): string => {
  return new Date().toISOString().substring(11, 23) // HH:mm:ss.SSS
}

const log = (
  level: LogLevel,
  context: string,
  message: string,
  ...data: unknown[]
): void => {
  // Early return for performance - no string formatting if suppressed
  if (!shouldLog(level)) return

  const timestamp = formatTimestamp()
  const prefix = `${timestamp} [${level.toUpperCase()}] [${context}]`

  const consoleFn = console[level]
  if (data.length > 0) {
    consoleFn(prefix, message, ...data)
  } else {
    consoleFn(prefix, message)
  }
}

export const logger = {
  debug: (context: string, message: string, ...data: unknown[]) =>
    log('debug', context, message, ...data),
  info: (context: string, message: string, ...data: unknown[]) =>
    log('info', context, message, ...data),
  warn: (context: string, message: string, ...data: unknown[]) =>
    log('warn', context, message, ...data),
  error: (context: string, message: string, ...data: unknown[]) =>
    log('error', context, message, ...data),
}
```

### Usage Examples

```typescript
import { logger } from '@/lib/logger'

// Basic logging
logger.info('Auth', 'User logged in successfully')
logger.error('API', 'Failed to fetch channels')

// With additional data
logger.debug('WebSocket', 'Received message', { type: 'channel_update', channel })
logger.warn('Player', 'Buffering detected', { currentTime: video.currentTime })
```

### Output Examples

```
12:34:56.789 [DEBUG] [WebSocket] Connecting to server
12:34:57.123 [INFO] [Auth] User logged in successfully
12:34:58.456 [ERROR] [API] Failed to fetch channels { status: 503, message: "..." }
```

### Environment Variables

Add to `.env.example`:
```bash
# Frontend Logging
VITE_LOG_LEVEL=debug    # debug, info, warn, error (default: warn in prod)
```

### Performance Considerations

- **Early return** before any string formatting when level is suppressed
- Configured level is cached at module load time (not read on every log call)
- No heavy object serialization unless log will actually be output
- In production with `VITE_LOG_LEVEL=error`, debug/info/warn calls are essentially no-ops

### Testing Strategy

- Mock `console.debug`, `console.info`, etc. with vi.fn()
- Test each log level calls correct console method
- Test level filtering by setting VITE_LOG_LEVEL
- Verify timestamp format is correct
- Test that suppressed logs don't call console methods

### TypeScript Types

```typescript
// Add to frontend/src/lib/logger.ts or types/index.ts

declare global {
  interface ImportMetaEnv {
    VITE_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error'
  }
}
```

### References

- [Source: frontend/src/lib/utils.ts - existing lib pattern]
- [Source: _bmad-output/project-context.md#TypeScript/React Rules]
- [Source: epics.md#Epic 9 - Story 9.4]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None

### Completion Notes List

- Created `frontend/src/lib/logger.ts` with structured logging utility
- Implemented LogLevel type with priority-based filtering (debug=0, info=1, warn=2, error=3)
- Logger reads `VITE_LOG_LEVEL` from environment, defaults to 'debug' in dev and 'warn' in production
- Early-return pattern ensures no performance overhead for suppressed logs
- Output format: `HH:mm:ss.SSS [LEVEL] [Context] message` with optional data arguments
- Added `VITE_LOG_LEVEL` to `.env.example` and `.env.development` with documentation
- Comprehensive test suite with 12 tests covering all acceptance criteria

### Change Log

- 2026-01-04: Implemented frontend logger utility (Story 9.4)

### File List

- frontend/src/lib/logger.ts (new)
- frontend/src/lib/logger.test.ts (new)
- frontend/.env.example (modified)
- frontend/.env.development (modified)
