# Story 12.4: Highlight Capture (Desktop)

Status: completed

> **ARCHITECTURE CHANGE:** See `sprint-change-proposal-2026-01-06.md`
> Browser-based approach deprecated. Server-side FFmpeg capture implemented instead.

## Story

As a desktop viewer,
I want to save the last minute of video with one click,
So that I can capture memorable moments from live streams.

## Acceptance Criteria

1. **Given** I am watching video on a desktop browser, **when** the video player renders AND the highlight feature is enabled on the server, **then** I see a "Save Highlight" button in the video controls

2. **Given** I am watching video on a mobile browser, **when** the video player renders, **then** the "Save Highlight" button is NOT visible

3. **Given** the highlight feature is disabled on the server (`HIGHLIGHT_ENABLED=false`), **when** the video player renders, **then** the "Save Highlight" button is NOT visible

4. **Given** I am watching and the FFmpeg buffer has accumulated, **when** I click "Save Highlight", **then** the last 60 seconds of video (configurable) is downloaded as an `.mp4` file

5. **Given** I just started watching (less than buffer duration), **when** I click "Save Highlight", **then** whatever has been recorded so far is downloaded, and I see a toast indicating partial capture

6. **Given** I am on the Live TV view OR ErsatzTV view, **when** I click "Save Highlight", **then** the feature works identically on both views

## Tasks / Subtasks (Server-Side Implementation)

- [x] Task 1: Add Backend Configuration
  - [x] Add `HIGHLIGHT_ENABLED` feature flag to `backend/app/config.py` (default: false)
  - [x] Add `HIGHLIGHT_BUFFER_SECONDS` config (default: 60)
  - [x] Add `HIGHLIGHT_SEGMENT_SECONDS` config (default: 10)
  - [x] Add `HIGHLIGHT_TEMP_DIR` config (default: /tmp/highlights)

- [x] Task 2: Create HighlightService (Backend)
  - [x] Create `backend/app/services/highlight.py`
  - [x] Implement `ChannelRecorder` class that manages FFmpeg process per channel
  - [x] Implement circular buffer using FFmpeg segment muxer with wrap
  - [x] Implement `start_recording()`, `stop_recording()`, `save_highlight()` methods
  - [x] Add cleanup on shutdown via lifespan handler

- [x] Task 3: Create Highlight API Endpoints
  - [x] Create `backend/app/routers/highlight.py`
  - [x] `GET /api/highlight/feature` - Check if feature is enabled
  - [x] `GET /api/highlight/status/{channel_id}` - Get recording status
  - [x] `POST /api/highlight/{channel_id}` - Save and download highlight

- [x] Task 4: Integrate with Channel State
  - [x] Modify `channel_state.set_current_channel()` to start recording when feature enabled
  - [x] Register highlight router in `main.py`
  - [x] Add FFmpeg cleanup to app shutdown

- [x] Task 5: Update Dockerfile
  - [x] Add `ffmpeg` to apt-get install in Stage 2

- [x] Task 6: Create Frontend API Functions
  - [x] Add `getHighlightFeatureEnabled()` to `frontend/src/services/api.ts`
  - [x] Add `getHighlightStatus()` to `frontend/src/services/api.ts`
  - [x] Add `saveHighlight()` to `frontend/src/services/api.ts`

- [x] Task 7: Create useHighlightFeature Hook
  - [x] Create `frontend/src/hooks/useHighlightFeature.ts`
  - [x] Fetch feature flag on mount
  - [x] Return `{ isEnabled, isLoading }`

- [x] Task 8: Create HighlightButton Component
  - [x] Create `frontend/src/components/HighlightButton.tsx`
  - [x] Use `Download` icon from lucide-react
  - [x] Poll for status every 5 seconds
  - [x] Show progress ring while buffer fills
  - [x] Disable when not recording
  - [x] Download MP4 via API call

- [x] Task 9: Integrate into VideoControls
  - [x] Import HighlightButton and useHighlightFeature
  - [x] Add `channelId` prop
  - [x] Only show button when feature enabled AND desktop AND has channelId

- [x] Task 10: Integrate into ErsatzTVVideoControls
  - [x] Import HighlightButton and useHighlightFeature
  - [x] Add `channelId` prop
  - [x] Only show button when feature enabled AND desktop AND has channelId

- [x] Task 11: Update Environment Examples
  - [x] Add highlight config section to `.env.example`

- [x] Task 12: Write Backend Tests
  - [x] Create `backend/tests/services/test_highlight.py`
  - [x] Create `backend/tests/routers/test_highlight.py`
  - [x] Test service methods and edge cases
  - [x] Test API endpoints with mocked service

- [x] Task 13: Write Frontend Tests
  - [x] Create `frontend/src/hooks/useHighlightFeature.test.ts`
  - [x] Create `frontend/src/components/HighlightButton.test.tsx`
  - [x] Update VideoControls.test.tsx with hook mock
  - [x] Update ErsatzTVVideoControls.test.tsx with hook mock

- [x] Task 14: Build and Test
  - [x] Run `uv run pytest` - all 441 backend tests pass
  - [x] Run `npm run test` - all 705 frontend tests pass
  - [x] Run `npm run build` - builds successfully

## Dev Notes

### Architecture: Server-Side FFmpeg

The browser-based canvas + MediaRecorder approach was deprecated due to:
1. WebM corruption with circular buffers
2. Audio muting issues with MSE streams
3. Quality loss from canvas re-encoding
4. Browser codec limitations

Server-side solution using FFmpeg:
1. FFmpeg records HLS/MPEG-TS streams directly at source quality
2. Uses segment muxer with wrap for circular buffer
3. Concatenates segments on demand for MP4 download
4. No re-encoding - copy codec mode

### FFmpeg Command

```bash
ffmpeg -y -hide_banner -loglevel warning \
  -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -i {stream_url} \
  -c copy \
  -f segment \
  -segment_time 10 \
  -segment_list segments.txt \
  -segment_list_type flat \
  -segment_wrap 8 \
  -reset_timestamps 1 \
  seg_%03d.ts
```

### API Endpoints

```
GET  /api/highlight/feature          - Check if enabled
GET  /api/highlight/status/{id}      - Recording status
POST /api/highlight/{id}             - Download highlight MP4
```

### Frontend Integration

The button is conditionally rendered based on:
- `useHighlightFeature()` hook returns `isEnabled: true`
- Device is not mobile (pointer: coarse check)
- Device is not TV mode
- Channel ID is available

### File Structure

**Backend:**
- `backend/app/config.py` - Added highlight settings
- `backend/app/services/highlight.py` - ChannelRecorder + HighlightService
- `backend/app/routers/highlight.py` - API endpoints
- `backend/app/main.py` - Router registration + shutdown
- `backend/app/services/channel_state.py` - Recording trigger

**Frontend:**
- `frontend/src/services/api.ts` - API functions
- `frontend/src/hooks/useHighlightFeature.ts` - Feature flag hook
- `frontend/src/components/HighlightButton.tsx` - UI component
- `frontend/src/components/VideoControls.tsx` - Integration
- `frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx` - Integration

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Completion Notes

- Fully rewrote from browser-based to server-side approach
- Feature is disabled by default (`HIGHLIGHT_ENABLED=false`)
- When enabled, FFmpeg starts recording when channel is selected
- Recording persists in `/tmp/highlights/{channel_id}/` directory
- Segments wrap after ~80 seconds (8 segments × 10 seconds)
- Download returns proper MP4 file with correct headers
- Button shows progress ring while buffer fills
- Toast notifications for success, partial capture, and errors

### Test Coverage

**Backend (24 new tests):**
- `tests/services/test_highlight.py` - 14 tests for service
- `tests/routers/test_highlight.py` - 10 tests for API

**Frontend (17 new tests):**
- `hooks/useHighlightFeature.test.ts` - 5 tests
- `components/HighlightButton.test.tsx` - 12 tests

All existing tests continue to pass:
- Backend: 441 tests
- Frontend: 705 tests

## Change Log

- 2026-01-06: Complete rewrite with server-side FFmpeg implementation
- 2026-01-05: Browser-based approach deprecated due to technical limitations
- 2026-01-05: Initial browser-based implementation (archived)
