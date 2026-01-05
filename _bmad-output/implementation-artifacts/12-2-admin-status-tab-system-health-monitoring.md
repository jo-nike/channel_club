# Story 12.2: Admin Status Tab - System Health Monitoring

Status: ready-for-dev

## Story

As an admin,
I want to see ErsatzTV and Dispatcharr system status in the admin modal,
So that I can monitor service health and resource usage.

## Acceptance Criteria

1. **Given** I open the admin modal, **when** I navigate to the "Status" tab, **then** I see status cards for ErsatzTV and Dispatcharr

2. **Given** ErsatzTV is reachable, **when** viewing its status card, **then** I see: connection status (Online), active streams, transcoding sessions, CPU usage (if available via API)

3. **Given** Dispatcharr is reachable, **when** viewing its status card, **then** I see: connection status (Online), active streams, health metrics (if available via API)

4. **Given** a service is unreachable, **when** viewing its status card, **then** I see: connection status (Offline) with error indication

5. **Given** the status tab is open, **when** I remain on the tab, **then** status refreshes automatically every 30 seconds

## Tasks / Subtasks

- [ ] Task 1: Research ErsatzTV API Endpoints (AC: #2)
  - [ ] Explore ErsatzTV Swagger UI at `{ersatztv_base_url}/swagger` or `/api`
  - [ ] Identify health/status endpoints for: active streams, transcoding sessions, system info
  - [ ] Document available endpoints and response schemas
  - [ ] Determine which metrics are realistically available (CPU may not be exposed)

- [ ] Task 2: Research Dispatcharr API Endpoints (AC: #3)
  - [ ] Explore Dispatcharr Swagger at `:9191/swagger/`
  - [ ] Identify endpoints for: active streams, stream health, client count
  - [ ] Document available endpoints and response schemas
  - [ ] Note: Real-Time Stats Dashboard exists per docs - find corresponding API

- [ ] Task 3: Create Backend Status Service (AC: #2, #3, #4)
  - [ ] Create `backend/app/services/status_service.py`
  - [ ] Implement `get_ersatztv_status()` async function with httpx client
  - [ ] Implement `get_dispatcharr_status()` async function with httpx client
  - [ ] Handle connection errors gracefully - return offline status with error message
  - [ ] Add appropriate logging with `loguru`

- [ ] Task 4: Create Status Models (AC: #2, #3)
  - [ ] Create `backend/app/models/status.py`
  - [ ] Define `ServiceStatus` Pydantic model (name, online, lastChecked, error?)
  - [ ] Define `ErsatzTVStatus(ServiceStatus)` with ErsatzTV-specific fields
  - [ ] Define `DispatchrStatus(ServiceStatus)` with Dispatcharr-specific fields
  - [ ] Define `SystemStatusResponse` combining both services
  - [ ] Use camelCase aliases for JSON serialization

- [ ] Task 5: Create Admin Status Router Endpoint (AC: #1, #2, #3, #4)
  - [ ] Add endpoint to `backend/app/routers/admin.py`: `GET /api/admin/status`
  - [ ] Require admin authentication
  - [ ] Return `SystemStatusResponse` with both service statuses
  - [ ] Add appropriate error handling

- [ ] Task 6: Create Frontend StatusTab Component (AC: #1, #2, #3, #4)
  - [ ] Create `frontend/src/components/admin/StatusTab.tsx`
  - [ ] Use named export per project conventions
  - [ ] Create status card layout showing both services
  - [ ] Use shadcn/ui Card components for consistent styling
  - [ ] Show online/offline indicator with appropriate colors (green/red)
  - [ ] Display available metrics from API response

- [ ] Task 7: Implement Auto-Refresh (AC: #5)
  - [ ] Add `useEffect` with 30-second interval for status polling
  - [ ] Clean up interval on component unmount
  - [ ] Add manual refresh button as UX enhancement
  - [ ] Show loading indicator during refresh

- [ ] Task 8: Replace PlaceholderTab with StatusTab (AC: #1)
  - [ ] Update `frontend/src/components/AdminModal.tsx`
  - [ ] Import StatusTab component
  - [ ] Replace PlaceholderTab in 'status' case with StatusTab
  - [ ] Remove status PlaceholderTab description text

- [ ] Task 9: Create Frontend API Service (AC: #1)
  - [ ] Add `fetchSystemStatus()` to `frontend/src/services/adminApi.ts` (or create if needed)
  - [ ] Use existing `fetchWithAuth` pattern for authenticated requests
  - [ ] Return typed `SystemStatusResponse`

- [ ] Task 10: Write Backend Tests (AC: #2, #3, #4)
  - [ ] Create `backend/app/services/status_service_test.py`
  - [ ] Test ErsatzTV status fetch - success and failure cases
  - [ ] Test Dispatcharr status fetch - success and failure cases
  - [ ] Mock external HTTP calls with `pytest-httpx` or similar
  - [ ] Create `backend/app/routers/admin_status_test.py` for endpoint tests

- [ ] Task 11: Write Frontend Tests (AC: #1, #5)
  - [ ] Create `frontend/src/components/admin/StatusTab.test.tsx`
  - [ ] Test component renders status cards
  - [ ] Test online/offline states display correctly
  - [ ] Test auto-refresh interval setup and cleanup
  - [ ] Test loading states

- [ ] Task 12: Verify and Test
  - [ ] Run `npm run build` - no errors
  - [ ] Run `npm run test` - all tests pass
  - [ ] Run `uv run pytest` - all backend tests pass
  - [ ] Manual test: Status tab opens in admin modal
  - [ ] Manual test: Shows real status from ErsatzTV/Dispatcharr
  - [ ] Manual test: Shows offline when services unavailable
  - [ ] Manual test: Auto-refresh works every 30 seconds

## Dev Notes

### Architecture Pattern from Previous Story (12-1)

- Story 12-1 added the Status tab as a **placeholder** - this story implements it
- AdminModal already has 5 tabs including 'status': `['channels', 'active-users', 'user-access', 'plugins', 'status']`
- PlaceholderTab component shows: "System health monitoring coming soon"
- Pattern: Replace PlaceholderTab with real StatusTab component

### Existing Service Patterns to Follow

**Backend Services:**
```python
# Pattern from dispatcharr.py
from loguru import logger
from app.config import settings

log = logger.bind(service="status")

async def get_ersatztv_status() -> ErsatzTVStatus:
    """Fetch status from ErsatzTV API."""
    url = f"{settings.ersatztv_base_url}/api/health"  # TBD from research
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            # Parse and return
    except httpx.HTTPError as e:
        log.error("Failed to fetch ErsatzTV status: {}", str(e))
        return ErsatzTVStatus(name="ErsatzTV", online=False, error=str(e))
```

**Frontend Components:**
```tsx
// Pattern from ActiveUsersTab.tsx
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function StatusTab() {
  const [status, setStatus] = useState<SystemStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStatus = async () => {
      const data = await fetchSystemStatus()
      setStatus(data)
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [])
  // ...
}
```

### API Research Required

**ErsatzTV (ersatztv.org):**
- Web research indicates API endpoints exist for transcoding sessions
- v0.8.5-beta added "API endpoints for interacting with transcoding sessions (MPEG-TS and HLS Segmenter)"
- Look for: `/api/health`, `/api/statistics`, `/api/ffmpeg/sessions`
- Settings exposed: FFmpegSettings including HlsSegmenterIdleTimeout, WorkAheadSegmenterLimit
- Try: `{ersatztv_base_url}/swagger` or `{ersatztv_base_url}/api`

**Dispatcharr (github.com/Dispatcharr/Dispatcharr):**
- Swagger available at `:9191/swagger/`
- Has "Real-Time Stats Dashboard" per docs - need to find API equivalent
- Look for: `/api/stats`, `/api/streams`, `/api/health`
- May expose: active streams, client count, stream health

### Graceful Degradation

If API endpoints are not found or return unexpected data:
1. Show "Connection: Online" if service responds to any request
2. Show "Metrics unavailable" for fields that can't be retrieved
3. Log warning but don't fail the entire status check

### Status Card Design

```
┌─────────────────────────────────┐
│ ErsatzTV                    🟢  │
├─────────────────────────────────┤
│ Status: Online                  │
│ Active Streams: 3               │
│ Transcoding: 2 sessions         │
│ Last Checked: 12:34:56          │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Dispatcharr                 🟢  │
├─────────────────────────────────┤
│ Status: Online                  │
│ Active Streams: 5               │
│ Connected Clients: 8            │
│ Last Checked: 12:34:56          │
└─────────────────────────────────┘
```

### Project Structure Notes

**New Files to Create:**
- `backend/app/services/status_service.py` - Status fetching service
- `backend/app/models/status.py` - Pydantic models for status
- `frontend/src/components/admin/StatusTab.tsx` - React component
- `frontend/src/components/admin/StatusTab.test.tsx` - Tests
- `backend/app/services/status_service_test.py` - Backend tests

**Files to Modify:**
- `backend/app/routers/admin.py` - Add GET /api/admin/status endpoint
- `frontend/src/components/AdminModal.tsx` - Replace PlaceholderTab with StatusTab
- `frontend/src/services/adminApi.ts` - Add fetchSystemStatus (create if needed)

### Configuration

Uses existing settings from `backend/app/config.py`:
- `settings.ersatztv_base_url` - ErsatzTV server URL (default: http://192.168.50.108:8409)
- `settings.dispatcharr_url` - Dispatcharr server URL (default: http://10.8.0.2:9191)

No new environment variables required.

### References

- [Source: frontend/src/components/AdminModal.tsx:72-79] - Current Status PlaceholderTab
- [Source: frontend/src/components/admin/ActiveUsersTab.tsx] - Pattern for admin tabs
- [Source: backend/app/services/dispatcharr.py] - Dispatcharr service pattern
- [Source: backend/app/services/ersatztv/epg_service.py] - ErsatzTV service pattern
- [Source: backend/app/config.py:8-42] - Service URLs configuration
- [Source: _bmad-output/project-context.md] - Project conventions
- [Source: _bmad-output/project-planning-artifacts/epics.md#story-122] - Original requirements
- [Source: _bmad-output/implementation-artifacts/12-1-*.md] - Previous story learnings

### Previous Story Intelligence (12-1)

**Key Learnings:**
- AdminModal already has Status tab placeholder - just replace content
- All 663 frontend tests pass with current structure
- Use PlaceholderTab pattern for consistent styling
- TVView is now at `/` (root route)
- Tab structure uses `TabType` union type

**Git Context:**
- Recent commits: `f12d5f4`, `b53bf56` (bmad additions), `6e1279d` (united view fixes)
- TVView is actively developed and stable

### External API Documentation

**ErsatzTV:**
- Docs: https://ersatztv.org/docs/
- GitHub: https://github.com/ErsatzTV/ErsatzTV
- Known endpoints from web research:
  - Transcoding session management (v0.8.5+)
  - Channel streaming modes exposed via API
  - FFmpeg settings accessible

**Dispatcharr:**
- Swagger: `http://{host}:9191/swagger/`
- GitHub: https://github.com/Dispatcharr/Dispatcharr
- Features per docs:
  - Real-Time Stats Dashboard
  - Stream health monitoring
  - Client activity tracking

### Testing Checklist

- [ ] `npm run build` succeeds (no dead imports)
- [ ] `npm run test` passes (updated tests)
- [ ] `uv run pytest` passes (backend tests)
- [ ] Status tab opens in admin modal (manual test)
- [ ] ErsatzTV status displays correctly (manual test)
- [ ] Dispatcharr status displays correctly (manual test)
- [ ] Offline state displays when services unreachable (manual test)
- [ ] Auto-refresh works every 30 seconds (manual test)
- [ ] No console errors (manual test)

### Potential Risks

1. **API Not Exposed** - ErsatzTV/Dispatcharr may not expose health endpoints
   - Mitigation: Fall back to simple connectivity check (any successful response = online)
2. **Auth Required** - External APIs may require authentication
   - Mitigation: Document in error message, suggest configuration
3. **CORS Issues** - If calling from frontend directly
   - Mitigation: All calls go through our backend (already the pattern)
4. **Rate Limiting** - 30-second polling may be too aggressive
   - Mitigation: Make interval configurable, respect rate limits

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-01-04: Story 12.2 created by BMad workflow - ready for implementation
