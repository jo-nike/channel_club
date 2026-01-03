---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
status: complete
completedAt: '2025-12-23'
lastStep: 8
inputDocuments:
  - '_bmad-output/prd.md'
  - '_bmad-output/research/dispatcharr-iptv-viewer-research.md'
workflowType: 'architecture'
project_name: 'iptv_viewer2'
user_name: 'Jon'
date: '2025-12-23'
hasProjectContext: false
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
26 FRs organized into 5 domains:
- **Authentication (FR1-5)**: JWT-based auth with admin/viewer role distinction
- **Channel Management (FR6-10)**: Admin-only channel selection from Dispatcharr lineup
- **Video Playback (FR11-15)**: HLS streaming via Vidstack, fullscreen, volume, error recovery
- **Real-time Sync (FR16-20)**: WebSocket channel broadcasts, auto-switch, reconnection
- **User Interface (FR21-26)**: Responsive layouts (desktop/mobile/TV), keyboard/remote navigation, auto-hiding controls

**Non-Functional Requirements:**
15 NFRs driving architectural choices:
- **Performance (NFR1-5)**: 3s stream start, 2s channel switch, 500ms WebSocket delivery
- **Reliability (NFR6-8)**: Auto-reconnect, stream recovery, graceful Dispatcharr unavailability
- **Integration (NFR9-11)**: Dispatcharr API v0.15+, HLS streams, UUID channel format
- **Usability (NFR12-15)**: 44px touch targets, 24px minimum text, high contrast, full D-pad navigation

**Scale & Complexity:**

- Primary domain: Full-stack Web Application (SPA + thin backend)
- Complexity level: Low-Medium
- Estimated architectural components: ~8 (Auth, Channel State, WebSocket Server, React App, Video Player, Admin UI, Viewer UI, API Gateway)

### Technical Constraints & Dependencies

| Constraint | Impact |
|------------|--------|
| Dispatcharr on VPS (10.8.0.2) | Backend must proxy API calls via Wireguard; streams exposed publicly via NPM |
| TV Browser Support (WebOS/Tizen) | Limited JS features, must test HLS/Vidstack compatibility early |
| No VPN for viewers | Streams must be publicly accessible via `streams.domain.com` |
| Simple auth (hardcoded creds) | No user management complexity, but upgrade path needed post-MVP |
| <500KB bundle target | Constrains UI library choices; Vidstack is modular (good fit) |

### Cross-Cutting Concerns Identified

1. **Authentication State** - JWT tokens shared between React app and WebSocket connection
2. **Connection Resilience** - Both HTTP and WebSocket need retry/reconnect logic
3. **Responsive/10-Foot UI** - Every component must adapt to 3 form factors with different interaction models
4. **Error Handling** - Stream failures, API unavailability, WebSocket drops all need graceful UX
5. **Loading States** - Video buffering, channel switching, initial load all need visual feedback

## Starter Template Evaluation

### Primary Technology Domain

Full-stack Web Application (React SPA + FastAPI backend) based on project requirements analysis.

### Starter Options Considered

| Option | Description | Verdict |
|--------|-------------|---------|
| Official Vite React-TS | Minimal official template | ✓ Selected for frontend |
| Community shadcn template | Pre-bundled stack | Overly opinionated |
| Full Stack FastAPI Template | Official Django-like template | Overkill for thin backend |
| Minimal FastAPI | Just dependencies we need | ✓ Selected for backend |

### Selected Approach: Layered Manual Setup

**Rationale:** Project has specific technology requirements (Vidstack, 10-foot UI, WebSocket sync) that don't map to any existing full-stack template. Building from minimal starters ensures exact dependency control and avoids unused boilerplate.

**Frontend Initialization:**

```bash
# Create Vite React project with SWC (faster than Babel)
npm create vite@latest frontend -- --template react-swc-ts
cd frontend && npm install

# Add Tailwind CSS v4
npm install tailwindcss @tailwindcss/vite

# Initialize shadcn/ui
npx shadcn@latest init

# Add state management
npm install zustand@latest

# Add video player with HLS support
npm install vidstack@latest

# Add utilities
npm install clsx tailwind-merge lucide-react
```

**Backend Initialization:**

```bash
mkdir backend && cd backend
uv init
uv add fastapi uvicorn[standard] python-jose[cryptography] websockets
```

### Architectural Decisions Provided by Starter

**Language & Runtime:**
- TypeScript 5.x with strict mode
- React 19 with SWC compiler
- Python 3.13+ for backend (latest features: improved error messages, JIT compiler improvements)

**Styling Solution:**
- Tailwind CSS v4 with @tailwindcss/vite plugin
- shadcn/ui components (copy-paste, full ownership)
- CSS custom properties for theming

**Build Tooling:**
- Vite 6.x with hot module replacement
- SWC for fast TypeScript compilation
- Tree-shaking and code splitting built-in

**Testing Framework:**
- Vitest for frontend (Vite-native)
- pytest for backend

**Code Organization:**
- Vite default: `src/` with component co-location
- shadcn/ui: `src/components/ui/` for primitives
- Backend: FastAPI router-based organization

**Development Experience:**
- Sub-second HMR in development
- TypeScript strict mode for type safety
- Path aliases (`@/` → `src/`)

**Current Versions (December 2025):**

| Package | Version |
|---------|---------|
| Python | 3.13+ |
| React | 19.x |
| Vite | 6.x |
| Tailwind CSS | 4.x |
| Zustand | 5.0.9+ |
| Vidstack | 1.12.13+ |
| FastAPI | 0.115+ |

**Note:** Project initialization using these commands should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Data storage: In-memory (channel state) + environment variables (credentials)
- Auth: JWT with 7-day expiration, stored in localStorage
- WebSocket: JSON messages over native WebSocket
- Docker: Single container serving frontend + backend

**Important Decisions (Shape Architecture):**
- Dispatcharr integration: Backend proxies channel list API
- 10-foot UI: Native browser focus with Tailwind states
- Responsive: CSS breakpoints via Tailwind

**Deferred Decisions (Post-MVP):**
- Database persistence (SQLite/Redis if needed)
- Focus management library (if native proves insufficient)
- Refresh token rotation

### Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Channel State Storage | In-memory (Python dict) | Simplest approach; state resets on restart, viewers reconnect via WebSocket |
| Credentials Storage | Environment variables | Hardcoded for MVP; `.env` file for local, Docker env for prod |
| Session/Token Storage | None (stateless JWT) | No server-side session storage needed |

### Authentication & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth Method | JWT (python-jose) | Stateless, simple, industry standard |
| Token Expiration | 7 days | Private app with trusted users; balance convenience vs security |
| Token Storage (Frontend) | localStorage | Persists across sessions; XSS risk acceptable for private app |
| Credentials | Hardcoded in .env | MVP simplicity; upgrade path to DB later |

### API & Communication Patterns

| Decision | Choice | Rationale |
|----------|--------|-----------|
| REST API | FastAPI with Pydantic models | Type-safe, auto-docs, async support |
| WebSocket Protocol | Native WebSocket + JSON | Lightweight; no Socket.io overhead |
| Message Format | `{"type": "...", ...}` | Simple, extensible, easy to debug |
| Dispatcharr Integration | Backend proxy | Keeps Dispatcharr on VPN; only streams exposed publicly |

**WebSocket Message Types:**
```
Server → Client: {"type": "channel_update", "channel": {...}}
Server → Client: {"type": "connection_ack", "current_channel": {...}}
Client → Server: {"type": "ping"}
```

### Frontend Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State Management | Zustand | Lightweight (<1KB), no boilerplate, React hooks native |
| Focus Management | Native browser + Tailwind | shadcn/ui has good focus states; add library if needed |
| Responsive Strategy | Tailwind CSS breakpoints | `md:`, `lg:` prefixes; no JS device detection needed |
| Component Library | shadcn/ui | Copy-paste ownership, accessible, Tailwind-native |

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Container Strategy | Single container | FastAPI serves React static build; simpler ops |
| Python Tooling | uv | Fast package manager, handles venv creation |
| Config Management | .env files | `.env.development`, `.env.production`; docker-compose friendly |
| Reverse Proxy | Nginx Proxy Manager | Already deployed; handles SSL, routing to services |
| Stream Proxy | NPM → Dispatcharr | `streams.domain.com` routes to `/proxy/ts/stream/*` only |

### Decision Impact Analysis

**Implementation Sequence:**
1. Project scaffolding (Vite + FastAPI with uv)
2. Authentication (JWT endpoints + middleware)
3. Dispatcharr proxy (channel list endpoint)
4. WebSocket server (channel broadcast)
5. Video player (Vidstack + HLS)
6. UI components (admin channel list, viewer player)
7. Docker containerization
8. NPM configuration

**Cross-Component Dependencies:**
- Auth tokens must work for both REST and WebSocket connections
- WebSocket reconnection must re-authenticate
- Channel state shared between REST endpoint and WebSocket broadcast

## Implementation Patterns & Consistency Rules

### Naming Patterns

**API & Data:**

| Context | Convention | Example |
|---------|------------|---------|
| JSON fields | camelCase | `{"channelId": "uuid", "streamUrl": "..."}` |
| URL paths | kebab-case | `/api/channels`, `/api/auth/token` |
| Query params | camelCase | `?channelId=uuid` |

**Frontend (TypeScript/React):**

| Context | Convention | Example |
|---------|------------|---------|
| Component files | PascalCase | `ChannelList.tsx`, `VideoPlayer.tsx` |
| Hook files | camelCase | `useWebSocket.ts`, `useAuth.ts` |
| Utility files | camelCase | `api.ts`, `formatters.ts` |
| Components | PascalCase | `export function ChannelList()` |
| Hooks | camelCase with `use` prefix | `useAuthStore`, `useChannelStore` |
| Variables/functions | camelCase | `currentChannel`, `fetchChannels()` |
| Types/Interfaces | PascalCase | `Channel`, `AuthState` |

**Backend (Python):**

| Context | Convention | Example |
|---------|------------|---------|
| Module files | snake_case | `auth_service.py`, `channel_router.py` |
| Functions | snake_case | `get_current_channel()`, `verify_token()` |
| Classes | PascalCase | `ChannelState`, `TokenPayload` |
| Variables | snake_case | `current_channel`, `access_token` |

### Structure Patterns

**Frontend Organization:**
```
frontend/src/
├── components/       # React components
│   ├── ui/          # shadcn/ui primitives
│   ├── ChannelList.tsx
│   ├── VideoPlayer.tsx
│   └── AdminControls.tsx
├── hooks/           # Custom React hooks
│   ├── useWebSocket.ts
│   └── useAuth.ts
├── stores/          # Zustand stores
│   ├── authStore.ts
│   └── channelStore.ts
├── services/        # API calls
│   └── api.ts
├── lib/             # Utilities
│   └── utils.ts
├── types/           # Shared TypeScript types
│   └── index.ts
└── App.tsx
```

**Backend Organization:**
```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py           # FastAPI app entry
│   ├── config.py         # Settings from env
│   ├── routers/          # API route handlers
│   │   ├── auth.py
│   │   ├── channels.py
│   │   └── websocket.py
│   ├── services/         # Business logic
│   │   ├── dispatcharr.py
│   │   └── channel_state.py
│   └── models/           # Pydantic models
│       ├── auth.py
│       └── channel.py
├── pyproject.toml
└── .env
```

### Format Patterns

**API Response Format:**
```python
# Success - direct response
{"channelId": "uuid-here", "name": "TSN", "streamUrl": "..."}

# Error - FastAPI standard format
{"detail": "Invalid credentials", "code": "AUTH_FAILED"}

# List response - direct array
[{"channelId": "...", "name": "..."}, ...]
```

**WebSocket Message Format:**
```typescript
// Server → Client
{"type": "channel_update", "channel": {"channelId": "...", "name": "..."}}
{"type": "connection_ack", "currentChannel": {...} | null}

// Client → Server
{"type": "ping"}
```

**Date/Time Format:**
- Always ISO 8601 in API: `2025-12-23T10:00:00Z`
- Frontend formats for display using user locale

### Code Patterns

**React Components:**
```typescript
// Named exports, not default
export function ChannelList({ channels }: ChannelListProps) {
  // Component logic
}
```

**Zustand Stores:**
```typescript
// Hook-style naming, typed state
export const useChannelStore = create<ChannelState>((set) => ({
  currentChannel: null,
  setChannel: (channel) => set({ currentChannel: channel }),
}));
```

**API Service Functions:**
```typescript
// Async functions in services/api.ts
export async function fetchChannels(): Promise<Channel[]> {
  const response = await fetch('/api/channels');
  if (!response.ok) throw new Error('Failed to fetch');
  return response.json();
}
```

**FastAPI Routers:**
```python
# Typed responses, dependency injection
@router.get("/channels", response_model=list[Channel])
async def get_channels(token: str = Depends(verify_token)):
    return await dispatcharr_service.get_lineup()
```

### Process Patterns

**Error Handling:**
- Frontend: Try/catch with user-friendly toast notifications
- Backend: FastAPI HTTPException with `detail` and optional `code`
- WebSocket: Send `{"type": "error", "message": "..."}` on failures

**Loading States:**
- Use Zustand store flags: `isLoading`, `isConnecting`
- Show skeleton/spinner components during load
- Disable interactive elements while loading

**Environment Variables:**
- Frontend: `VITE_API_URL`, `VITE_WS_URL` (must have VITE_ prefix)
- Backend: `DISPATCHARR_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`, `VIEWER_PASSWORD`

### Test Patterns

**Test File Location:**
- Co-located with source: `ChannelList.test.tsx`, `auth_test.py`
- Test naming: `describe('ChannelList')` / `def test_login_success()`

### Enforcement Guidelines

**All AI Agents MUST:**
1. Follow naming conventions exactly as specified above
2. Place files in the correct directory structure
3. Use the defined API response format
4. Match WebSocket message types exactly
5. Use named exports for React components
6. Prefix frontend env vars with `VITE_`

**Anti-Patterns to Avoid:**
- ❌ Default exports for components
- ❌ snake_case in JSON responses
- ❌ Mixing component styles (some PascalCase, some kebab-case)
- ❌ Putting business logic in routers (use services)
- ❌ Hardcoding URLs (use environment variables)

## Project Structure & Boundaries

### Complete Project Directory Structure

```
iptv_viewer2/
├── README.md
├── docker-compose.yml
├── Dockerfile
├── .gitignore
├── .env.example
│
├── frontend/
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── tsconfig.node.json
│   ├── components.json              # shadcn/ui config
│   ├── index.html
│   ├── .env.development
│   ├── .env.production
│   │
│   ├── public/
│   │   └── favicon.ico
│   │
│   └── src/
│       ├── main.tsx                  # App entry point
│       ├── App.tsx                   # Root component + routing
│       ├── index.css                 # Tailwind imports
│       │
│       ├── components/
│       │   ├── ui/                   # shadcn/ui primitives
│       │   │   ├── button.tsx
│       │   │   ├── input.tsx
│       │   │   ├── card.tsx
│       │   │   └── toast.tsx
│       │   ├── VideoPlayer.tsx       # Vidstack wrapper
│       │   ├── ChannelList.tsx       # Channel selection grid
│       │   ├── AdminControls.tsx     # Admin channel picker
│       │   ├── LoginForm.tsx         # Auth form
│       │   └── ConnectionStatus.tsx  # WebSocket indicator
│       │
│       ├── hooks/
│       │   ├── useWebSocket.ts       # WebSocket connection + reconnect
│       │   └── useAuth.ts            # Auth state + token management
│       │
│       ├── stores/
│       │   ├── authStore.ts          # Zustand: auth state
│       │   └── channelStore.ts       # Zustand: channel state
│       │
│       ├── services/
│       │   └── api.ts                # API client functions
│       │
│       ├── lib/
│       │   └── utils.ts              # cn() and utilities
│       │
│       └── types/
│           └── index.ts              # Shared TypeScript types
│
├── backend/
│   ├── pyproject.toml                # uv project config
│   ├── uv.lock
│   ├── .python-version               # 3.13
│   ├── .env
│   ├── .env.example
│   │
│   └── app/
│       ├── __init__.py
│       ├── main.py                   # FastAPI app + static serving
│       ├── config.py                 # Settings from environment
│       │
│       ├── routers/
│       │   ├── __init__.py
│       │   ├── auth.py               # POST /api/auth/token
│       │   ├── channels.py           # GET /api/channels
│       │   └── websocket.py          # WS /api/ws
│       │
│       ├── services/
│       │   ├── __init__.py
│       │   ├── dispatcharr.py        # Dispatcharr API client
│       │   └── channel_state.py      # In-memory channel state
│       │
│       └── models/
│           ├── __init__.py
│           ├── auth.py               # TokenPayload, LoginRequest
│           └── channel.py            # Channel, ChannelState
│
└── _bmad-output/                     # Planning artifacts (gitignored)
    ├── prd.md
    ├── architecture.md
    └── research/
```

### Architectural Boundaries

**API Boundaries:**

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/auth/token` | POST | None | Login, returns JWT |
| `/api/channels` | GET | JWT | Fetch channel list from Dispatcharr |
| `/api/channels/current` | GET | JWT | Get current channel |
| `/api/channels/current` | PUT | Admin JWT | Set current channel (broadcasts to WS) |
| `/api/ws` | WS | JWT (query param) | Real-time channel updates |

**Component Boundaries:**

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
├─────────────────────────────────────────────────────────────┤
│  App.tsx                                                     │
│    ├── LoginForm ←→ authStore ←→ api.ts                     │
│    ├── VideoPlayer ←→ channelStore                          │
│    ├── ChannelList ←→ channelStore ←→ api.ts                │
│    ├── AdminControls ←→ channelStore ←→ api.ts              │
│    └── ConnectionStatus ←→ useWebSocket                     │
├─────────────────────────────────────────────────────────────┤
│  useWebSocket hook                                           │
│    ├── Connects to /api/ws with JWT                         │
│    ├── Updates channelStore on channel_update               │
│    └── Auto-reconnects with exponential backoff             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Backend                               │
├─────────────────────────────────────────────────────────────┤
│  main.py                                                     │
│    ├── Mounts /api routers                                  │
│    ├── Serves frontend static files                         │
│    └── CORS middleware                                       │
├─────────────────────────────────────────────────────────────┤
│  routers/                                                    │
│    ├── auth.py → services/auth (verify credentials)         │
│    ├── channels.py → services/dispatcharr (proxy lineup)    │
│    └── websocket.py → services/channel_state (broadcast)    │
├─────────────────────────────────────────────────────────────┤
│  services/                                                   │
│    ├── dispatcharr.py → External: Dispatcharr API           │
│    └── channel_state.py → In-memory state + WS connections  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Services                         │
├─────────────────────────────────────────────────────────────┤
│  Dispatcharr (VPS 10.8.0.2:9191)                            │
│    ├── /hdhr/lineup.json → Channel list                     │
│    └── /proxy/ts/stream/{uuid} → HLS streams (public via NPM)│
└─────────────────────────────────────────────────────────────┘
```

### Requirements to Structure Mapping

**FR Domain: Authentication (FR1-5)**
- `frontend/src/components/LoginForm.tsx`
- `frontend/src/stores/authStore.ts`
- `frontend/src/hooks/useAuth.ts`
- `backend/app/routers/auth.py`
- `backend/app/models/auth.py`

**FR Domain: Channel Management (FR6-10)**
- `frontend/src/components/ChannelList.tsx`
- `frontend/src/components/AdminControls.tsx`
- `frontend/src/stores/channelStore.ts`
- `backend/app/routers/channels.py`
- `backend/app/services/dispatcharr.py`
- `backend/app/services/channel_state.py`
- `backend/app/models/channel.py`

**FR Domain: Video Playback (FR11-15)**
- `frontend/src/components/VideoPlayer.tsx`

**FR Domain: Real-time Sync (FR16-20)**
- `frontend/src/hooks/useWebSocket.ts`
- `frontend/src/components/ConnectionStatus.tsx`
- `backend/app/routers/websocket.py`
- `backend/app/services/channel_state.py`

**FR Domain: User Interface (FR21-26)**
- `frontend/src/components/ui/*` (shadcn primitives)
- `frontend/src/index.css` (Tailwind + responsive)
- `frontend/src/App.tsx` (layout + routing)

### Data Flow

```
1. AUTH FLOW:
   LoginForm → api.login() → POST /api/auth/token
   ← JWT token → authStore.setToken() → localStorage

2. CHANNEL LIST FLOW:
   ChannelList mount → api.fetchChannels() → GET /api/channels
   → dispatcharr.get_lineup() → Dispatcharr /hdhr/lineup.json
   ← channels[] → channelStore.setChannels()

3. CHANNEL CHANGE FLOW (Admin):
   AdminControls.selectChannel() → api.setChannel() → PUT /api/channels/current
   → channel_state.set_channel() → broadcast to all WebSocket connections
   ← {"type": "channel_update", "channel": {...}}
   → useWebSocket receives → channelStore.setCurrentChannel()
   → VideoPlayer re-renders with new streamUrl

4. VIEWER JOIN FLOW:
   useWebSocket connects → WS /api/ws?token=...
   ← {"type": "connection_ack", "currentChannel": {...}}
   → channelStore.setCurrentChannel()
   → VideoPlayer loads stream
```

### Integration Points

**Dispatcharr Integration:**
- Backend calls `http://10.8.0.2:9191/hdhr/lineup.json` via Wireguard
- Frontend video player loads `https://streams.domain.com/proxy/ts/stream/{uuid}`
- NPM proxies `streams.domain.com` → `10.8.0.2:9191` (path: `/proxy/ts/stream/*` only)

**NPM Configuration Required:**
```
Proxy Host: streams.domain.com
Scheme: http
Forward Host: 10.8.0.2
Forward Port: 9191
Custom Location: /proxy/ts/stream/
```

### Docker Structure

**Single Container Build:**
```dockerfile
# Build frontend
FROM node:22 AS frontend-build
WORKDIR /app/frontend
COPY frontend/ .
RUN npm ci && npm run build

# Production
FROM python:3.13-slim
WORKDIR /app
COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ./static
RUN pip install uv && uv sync
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

**Environment Variables:**
```bash
# Backend .env
DISPATCHARR_URL=http://10.8.0.2:9191
JWT_SECRET=your-secret-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password
VIEWER_USERNAME=viewer
VIEWER_PASSWORD=your-viewer-password

# Frontend .env.production
VITE_API_URL=/api
VITE_WS_URL=wss://iptv.domain.com/api/ws
VITE_STREAM_BASE_URL=https://streams.domain.com
```

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology choices are compatible and work together without conflicts:
- Frontend stack (React 19 + Vite 6 + Tailwind 4 + Vidstack) fully compatible
- Backend stack (FastAPI + python-jose + websockets) proven combination
- Cross-stack integration (JSON camelCase, JWT auth) properly specified

**Pattern Consistency:**
Implementation patterns align with technology stack:
- React patterns match Zustand conventions
- FastAPI patterns follow best practices
- Naming conventions respect each ecosystem

**Structure Alignment:**
Project structure fully supports architectural decisions:
- Single-container deployment works with frontend/backend separation
- Service layer pattern enables clean boundaries
- Static file serving configuration documented

### Requirements Coverage ✅

**Functional Requirements (26 FRs):**
All functional requirements have architectural support:
- FR1-5 (Auth): JWT implementation fully specified
- FR6-10 (Channels): Dispatcharr proxy architecture defined
- FR11-15 (Playback): Vidstack with HLS configuration ready
- FR16-20 (Sync): WebSocket protocol and messages documented
- FR21-26 (UI): Responsive patterns and 10-foot UI addressed

**Non-Functional Requirements (15 NFRs):**
All non-functional requirements architecturally supported:
- Performance: Bundle size constraints met, WebSocket for speed
- Reliability: Reconnection and error handling patterns defined
- Integration: Dispatcharr API compatibility ensured
- Usability: 10-foot UI patterns comprehensively documented

### Implementation Readiness ✅

**Decision Completeness:**
- All critical technology versions documented
- Initialization commands provided for both frontend and backend
- Environment variables fully specified
- Docker build configuration ready

**Structure Completeness:**
- Complete directory tree with all files defined
- Component boundaries clearly established
- Integration points explicitly mapped
- Data flows documented step-by-step

**Pattern Completeness:**
- Naming conventions cover all contexts
- API formats standardized
- WebSocket messages specified
- Error handling patterns documented

### Gap Analysis Results

**Critical Gaps:** None identified

**Minor Recommendations (Optional):**
1. Add `httpx` to backend dependencies for async Dispatcharr calls
2. Consider adding Vitest configuration to frontend init
3. Document WebSocket heartbeat interval (suggest 30s)

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (Low-Medium)
- [x] Technical constraints identified (TV browsers, VPN-free access)
- [x] Cross-cutting concerns mapped (5 concerns)

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified (7 core technologies)
- [x] Integration patterns defined (Dispatcharr, NPM)
- [x] Performance considerations addressed (<500KB, 3s targets)

**✅ Implementation Patterns**
- [x] Naming conventions established (API, frontend, backend)
- [x] Structure patterns defined (by-type organization)
- [x] Communication patterns specified (WebSocket JSON)
- [x] Process patterns documented (error handling, loading states)

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Clean separation of concerns (frontend/backend/external)
- Simple, focused architecture appropriate for MVP scope
- Comprehensive patterns prevent AI agent conflicts
- Well-documented data flows for implementation clarity

**Areas for Future Enhancement:**
- Database persistence (currently in-memory)
- Focus management library (if native proves insufficient)
- EPG integration (post-MVP feature)
- Multiple watch party rooms (vision scope)

### Implementation Handoff

**AI Agent Guidelines:**
1. Follow all architectural decisions exactly as documented
2. Use implementation patterns consistently across all components
3. Respect project structure and boundaries
4. Refer to this document for all architectural questions
5. Do not add complexity beyond what's specified

**First Implementation Priority:**
Project scaffolding using documented initialization commands:
```bash
# Frontend
npm create vite@latest frontend -- --template react-swc-ts

# Backend
mkdir backend && cd backend && uv init
```

## Architecture Completion Summary

### Workflow Completion

**Architecture Decision Workflow:** COMPLETED ✅
**Total Steps Completed:** 8
**Date Completed:** 2025-12-23
**Document Location:** `_bmad-output/architecture.md`

### Final Architecture Deliverables

**Complete Architecture Document**
- All architectural decisions documented with specific versions
- Implementation patterns ensuring AI agent consistency
- Complete project structure with all files and directories
- Requirements to architecture mapping
- Validation confirming coherence and completeness

**Implementation Ready Foundation**
- 15+ architectural decisions made
- 20+ implementation patterns defined
- 8 architectural components specified
- 41 requirements (26 FR + 15 NFR) fully supported

**AI Agent Implementation Guide**
- Technology stack with verified versions
- Consistency rules that prevent implementation conflicts
- Project structure with clear boundaries
- Integration patterns and communication standards

### Development Sequence

1. Initialize project using documented starter template
2. Set up development environment per architecture
3. Implement core architectural foundations (auth, WebSocket)
4. Build features following established patterns
5. Maintain consistency with documented rules

### Quality Assurance Checklist

**✅ Architecture Coherence**
- [x] All decisions work together without conflicts
- [x] Technology choices are compatible
- [x] Patterns support the architectural decisions
- [x] Structure aligns with all choices

**✅ Requirements Coverage**
- [x] All functional requirements are supported
- [x] All non-functional requirements are addressed
- [x] Cross-cutting concerns are handled
- [x] Integration points are defined

**✅ Implementation Readiness**
- [x] Decisions are specific and actionable
- [x] Patterns prevent agent conflicts
- [x] Structure is complete and unambiguous
- [x] Examples are provided for clarity

---

**Architecture Status:** READY FOR IMPLEMENTATION ✅

**Next Phase:** Begin implementation using the architectural decisions and patterns documented herein.

---

## Post-Implementation Updates

### 2025-12-26: Video Player Technology Change

**Original Design:** Vidstack with HLS support
**Actual Implementation:** mpegts.js v1.8.0 with MPEG-TS streams

**Reason for Change:**
1. Dispatcharr provides raw MPEG-TS streams at `/proxy/ts/stream/{uuid}`, NOT HLS
2. The `/proxy/hls/` endpoint does not exist in Dispatcharr
3. Browsers cannot play raw MPEG-TS natively - requires JavaScript decoder
4. Vidstack cannot decode raw MPEG-TS streams (only HLS which wraps TS segments)

**Solution:**
- Replaced Vidstack web components with mpegts.js player
- mpegts.js decodes MPEG-TS in JavaScript and feeds to native `<video>` element
- Native browser controls used instead of Vidstack skin

**Files Changed:**
- `frontend/src/components/VideoPlayer.tsx` - Complete rewrite using mpegts.js
- `backend/app/services/dispatcharr.py` - Fixed URL from `/proxy/hls/{uuid}/playlist.m3u8` to `/proxy/ts/stream/{uuid}`

**Stream URL Format (Corrected):**
```
https://streams.domain.com/proxy/ts/stream/{uuid}
```

**Note:** The `vidstack` package remains in package.json but is no longer used. Can be removed in future cleanup.

### 2026-01-03: Epic 6 - UI Polish & EPG Integration

**New Components Added:**

**Backend - EPG Service:**
- `backend/app/services/epg_service.py` - XMLTV parser with 24h caching
- Fetches from Dispatcharr `/xmltv.php`
- Parses XML, extracts current/next programs by channel
- In-memory cache with 24h TTL
- Dependency: `defusedxml` for safe XML parsing

**New API Endpoint:**

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/epg/now-playing` | GET | JWT | Get current program for channel |

**Query Parameters:**
- `channel_id` (required): The channel UUID to get EPG for

**Response Format:**
```json
{
  "channelId": "uuid",
  "currentProgram": {
    "title": "Program Name",
    "startTime": "2026-01-03T20:00:00Z",
    "endTime": "2026-01-03T21:00:00Z",
    "description": "Optional description"
  },
  "nextProgram": {
    "title": "Next Program",
    "startTime": "2026-01-03T21:00:00Z",
    "endTime": "2026-01-03T22:00:00Z"
  }
}
```

**Frontend UI Changes:**
- Header height reduced 50% (p-4 → p-2)
- Title changed: "IPTV Viewer" → "Jon's place"
- Current channel name displayed in header
- Now playing info displayed next to channel name
- Viewer role: No channel list access (video only)
- Admin role: Hamburger menu replaces pinned sidebar on all breakpoints
- Logout button: Fixed text overflow issue

**Data Flow - EPG:**
```
1. Frontend mounts with current channel
2. Call GET /api/epg/now-playing?channel_id=X
3. Backend checks cache (24h TTL)
4. If miss: fetch /xmltv.php from Dispatcharr, parse, cache
5. Return current program for channel
6. Frontend displays in header
7. Re-fetch on channel change
```

