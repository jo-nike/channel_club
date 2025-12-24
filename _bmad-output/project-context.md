---
project_name: 'iptv_viewer2'
user_name: 'Jon'
date: '2025-12-23'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'anti_patterns']
status: complete
rule_count: 35
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

| Technology | Version | Notes |
|------------|---------|-------|
| React | 19.x | With SWC compiler |
| TypeScript | 5.x | Strict mode enabled |
| Vite | 6.x | Build tool |
| Tailwind CSS | 4.x | With @tailwindcss/vite |
| shadcn/ui | latest | Copy-paste components |
| Zustand | 5.0.9+ | State management |
| Vidstack | 1.12.13+ | HLS video player |
| Python | 3.13+ | Backend runtime |
| FastAPI | 0.115+ | Backend framework |
| uv | latest | Python package manager |

## Critical Implementation Rules

### TypeScript/React Rules

- Use **named exports** for all components: `export function ChannelList()` not `export default`
- Component files are **PascalCase**: `ChannelList.tsx`, `VideoPlayer.tsx`
- Hook files are **camelCase** with `use` prefix: `useWebSocket.ts`, `useAuth.ts`
- All Zustand stores follow hook pattern: `useAuthStore`, `useChannelStore`
- Path alias `@/` maps to `src/` - always use it for imports
- Never use `any` type - define proper interfaces in `types/index.ts`

### Python/FastAPI Rules

- Module files are **snake_case**: `auth_service.py`, `channel_router.py`
- Use `uv` for all package management, never raw pip
- Business logic goes in `services/`, not in routers
- All Pydantic models use camelCase aliases for JSON serialization
- Use `async def` for all route handlers and service methods
- Dependency injection via `Depends()` for auth and services

### API & Data Format Rules

- JSON fields are **camelCase**: `{"channelId": "...", "streamUrl": "..."}`
- URL paths are **kebab-case**: `/api/channels`, `/api/auth/token`
- Errors use FastAPI format: `{"detail": "message", "code": "ERROR_CODE"}`
- Dates always ISO 8601: `2025-12-23T10:00:00Z`
- WebSocket messages: `{"type": "event_name", ...payload}`

### Testing Rules

- Test files co-located with source: `ChannelList.test.tsx`, `auth_test.py`
- Frontend uses Vitest, backend uses pytest
- Test naming: `describe('ComponentName')` / `def test_function_name()`
- Mock external services (Dispatcharr) in tests

### Code Quality Rules

- No default exports for React components
- No snake_case in JSON responses
- No hardcoded URLs - use environment variables
- No business logic in routers - use service layer
- Frontend env vars MUST have `VITE_` prefix

### 10-Foot UI Rules (TV Browser Support)

- Minimum touch target: 44px
- Minimum text size: 24px for body text
- All interactive elements must have visible focus states
- Full keyboard/D-pad navigation required
- Auto-hide controls after 3-5 seconds of inactivity
- Test on WebOS/Tizen browsers early

### Environment Variables

**Frontend (.env):**
- `VITE_API_URL` - API base URL
- `VITE_WS_URL` - WebSocket URL
- `VITE_STREAM_BASE_URL` - Stream proxy URL

**Backend (.env):**
- `DISPATCHARR_URL` - Dispatcharr API (internal)
- `JWT_SECRET` - Token signing key
- `ADMIN_USERNAME`, `ADMIN_PASSWORD` - Admin credentials
- `VIEWER_USERNAME`, `VIEWER_PASSWORD` - Viewer credentials

### Anti-Patterns to Avoid

- Do not use `export default` for components
- Do not mix PascalCase and kebab-case in component files
- Do not put async logic directly in components (use hooks/stores)
- Do not hardcode Dispatcharr URLs in frontend
- Do not use raw WebSocket without reconnection logic
- Do not ignore TypeScript errors with `// @ts-ignore`
- Do not create new files outside the defined project structure

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Refer to `architecture.md` for detailed decisions and structure

**For Humans:**
- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review periodically for outdated rules
- Remove rules that become obvious over time

**Related Documents:**
- `_bmad-output/architecture.md` - Complete architectural decisions
- `_bmad-output/prd.md` - Product requirements

Last Updated: 2025-12-23
