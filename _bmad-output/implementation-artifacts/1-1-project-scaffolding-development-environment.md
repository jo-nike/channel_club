# Story 1.1: Project Scaffolding & Development Environment

Status: review

## Story

As a developer,
I want a fully configured project with frontend and backend structure,
So that I can immediately start building features.

## Acceptance Criteria

1. **Given** a fresh project directory
   **When** I run the setup commands
   **Then** frontend initializes with Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui

2. **Given** frontend setup is complete
   **When** I run `npm run dev`
   **Then** the development server starts without errors on port 5173

3. **Given** a fresh project directory
   **When** I run the backend setup commands
   **Then** backend initializes with FastAPI + uv + python-jose + websockets

4. **Given** backend setup is complete
   **When** I run `uv run uvicorn app.main:app --reload`
   **Then** the development server starts without errors on port 8000

5. **Given** both frontend and backend are running
   **When** I check the project structure
   **Then** it matches the Architecture document layout exactly

## Tasks / Subtasks

- [x] Task 1: Initialize Frontend Project (AC: #1, #2)
  - [x] Run `npm create vite@latest frontend -- --template react-swc-ts`
  - [x] Install Tailwind CSS v4: `npm install tailwindcss @tailwindcss/vite`
  - [x] Configure Tailwind in vite.config.ts with @tailwindcss/vite plugin
  - [x] Create src/index.css with Tailwind imports
  - [x] Initialize shadcn/ui: `npx shadcn@latest init`
  - [x] Install state management: `npm install zustand@latest`
  - [x] Install video player: `npm install vidstack@latest`
  - [x] Install utilities: `npm install clsx tailwind-merge lucide-react`
  - [x] Configure path alias `@/` → `src/` in tsconfig.json
  - [x] Verify `npm run dev` starts successfully

- [x] Task 2: Initialize Backend Project (AC: #3, #4)
  - [x] Create backend directory and run `uv init`
  - [x] Add dependencies: `uv add fastapi uvicorn[standard] python-jose[cryptography] websockets httpx`
  - [x] Create .python-version file with `3.13`
  - [x] Create app/__init__.py
  - [x] Create app/main.py with basic FastAPI app
  - [x] Create app/config.py with Settings class using environment variables
  - [x] Verify `uv run uvicorn app.main:app --reload` starts successfully

- [x] Task 3: Create Project Directory Structure (AC: #5)
  - [x] Create frontend directory structure per Architecture document
  - [x] Create backend directory structure per Architecture document
  - [x] Create placeholder files for all components/services/stores
  - [x] Create .env.example files for both frontend and backend
  - [x] Create root-level README.md, .gitignore, docker-compose.yml placeholder

- [x] Task 4: Configure Environment Files
  - [x] Create frontend/.env.development with VITE_API_URL, VITE_WS_URL
  - [x] Create backend/.env with placeholder values for all env vars
  - [x] Create backend/.env.example documenting all required variables

## Dev Notes

### Technology Versions (CRITICAL - USE THESE EXACT VERSIONS)

| Package | Version | Installation |
|---------|---------|--------------|
| Python | 3.13+ | System requirement |
| React | 19.x | Via Vite template |
| Vite | 6.x | Via npm create vite@latest |
| Tailwind CSS | 4.x | npm install tailwindcss @tailwindcss/vite |
| Zustand | 5.0.9+ | npm install zustand@latest |
| Vidstack | 1.12.13+ | npm install vidstack@latest |
| FastAPI | 0.115+ | uv add fastapi |

### Frontend Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

### Backend Main.py Starter

```python
# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="IPTV Viewer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
```

### Project Structure Notes

**Frontend Structure:**
```
frontend/src/
├── components/       # React components
│   ├── ui/          # shadcn/ui primitives (created by npx shadcn)
│   ├── VideoPlayer.tsx
│   ├── ChannelList.tsx
│   ├── AdminControls.tsx
│   ├── LoginForm.tsx
│   └── ConnectionStatus.tsx
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

**Backend Structure:**
```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py           # FastAPI app entry
│   ├── config.py         # Settings from env
│   ├── routers/          # API route handlers
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   ├── channels.py
│   │   └── websocket.py
│   ├── services/         # Business logic
│   │   ├── __init__.py
│   │   ├── dispatcharr.py
│   │   └── channel_state.py
│   └── models/           # Pydantic models
│       ├── __init__.py
│       ├── auth.py
│       └── channel.py
├── pyproject.toml
└── .env
```

### Environment Variables

**Frontend (.env.development):**
```
VITE_API_URL=http://localhost:8000/api
VITE_WS_URL=ws://localhost:8000/api/ws
VITE_STREAM_BASE_URL=https://streams.domain.com
```

**Backend (.env):**
```
DISPATCHARR_URL=http://10.8.0.2:9191
JWT_SECRET=dev-secret-change-in-production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
VIEWER_USERNAME=viewer
VIEWER_PASSWORD=viewer
```

### Anti-Patterns to Avoid

- ❌ Do NOT use `export default` for React components - use named exports
- ❌ Do NOT skip path alias configuration
- ❌ Do NOT use pip instead of uv
- ❌ Do NOT hardcode URLs - use environment variables
- ❌ Do NOT create files outside the defined project structure

### References

- [Source: _bmad-output/architecture.md#Starter-Template-Evaluation]
- [Source: _bmad-output/architecture.md#Project-Structure-&-Boundaries]
- [Source: _bmad-output/project-context.md#Technology-Stack-&-Versions]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - scaffolding task with no complex debugging.

### Completion Notes List

- Initialized frontend with Vite + React 19 + TypeScript + SWC + Tailwind CSS v4 + shadcn/ui
- Configured path alias `@/` → `src/` in both vite.config.ts and tsconfig.json
- Installed state management (Zustand 5.x), video player (Vidstack), and utilities
- Initialized backend with uv + FastAPI + all required dependencies (python-jose, websockets, httpx, pydantic-settings)
- Created complete project directory structure matching Architecture document
- Created placeholder files for all components, hooks, stores, services, and types
- Configured environment files for both frontend and backend
- Verified both frontend and backend dev servers start successfully
- Frontend production build completes without errors

### File List

**Frontend (new/modified):**
- frontend/vite.config.ts (modified - added tailwindcss plugin and path alias)
- frontend/tsconfig.json (modified - added path alias)
- frontend/tsconfig.app.json (modified - added path alias)
- frontend/src/index.css (modified - replaced with Tailwind imports and shadcn theme)
- frontend/src/components/VideoPlayer.tsx (new)
- frontend/src/components/ChannelList.tsx (new)
- frontend/src/components/AdminControls.tsx (new)
- frontend/src/components/LoginForm.tsx (new)
- frontend/src/components/ConnectionStatus.tsx (new)
- frontend/src/hooks/useWebSocket.ts (new)
- frontend/src/hooks/useAuth.ts (new)
- frontend/src/stores/authStore.ts (new)
- frontend/src/stores/channelStore.ts (new)
- frontend/src/services/api.ts (new)
- frontend/src/types/index.ts (new)
- frontend/src/lib/utils.ts (new - created by shadcn)
- frontend/components.json (new - created by shadcn)
- frontend/.env.development (new)
- frontend/.env.example (new)
- frontend/package.json (modified - added dependencies)
- frontend/package-lock.json (modified)

**Backend (all new):**
- backend/.python-version
- backend/pyproject.toml
- backend/uv.lock
- backend/app/__init__.py
- backend/app/main.py
- backend/app/config.py
- backend/app/routers/__init__.py
- backend/app/routers/auth.py
- backend/app/routers/channels.py
- backend/app/routers/websocket.py
- backend/app/services/__init__.py
- backend/app/services/dispatcharr.py
- backend/app/services/channel_state.py
- backend/app/models/__init__.py
- backend/app/models/auth.py
- backend/app/models/channel.py
- backend/.env
- backend/.env.example

**Root level (new):**
- .gitignore
- docker-compose.yml

## Change Log

- 2025-12-23: Initial project scaffolding completed - frontend and backend initialized with all dependencies and directory structure

