---
stepsCompleted: [1, 2, 3, 4]
status: complete
completedAt: '2025-12-23'
inputDocuments:
  - '_bmad-output/prd.md'
  - '_bmad-output/architecture.md'
project_name: 'iptv_viewer2'
user_name: 'Jon'
date: '2025-12-23'
---

# iptv_viewer2 - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for iptv_viewer2, decomposing the requirements from the PRD and Architecture documents into implementable stories.

## Requirements Inventory

### Functional Requirements

**Authentication & Authorization (FR1-5):**
- FR1: Users can authenticate with username/password credentials
- FR2: System can distinguish between admin and viewer roles
- FR3: Admin can access channel management features
- FR4: Viewers can access the video player interface
- FR5: System can maintain authentication state across sessions (JWT)

**Channel Management - Admin (FR6-10):**
- FR6: Admin can view list of available channels from Dispatcharr
- FR7: Admin can select a channel to broadcast to all viewers
- FR8: Admin can see the currently selected channel
- FR9: Admin can change the channel at any time
- FR10: System can fetch channel lineup from Dispatcharr API

**Video Playback (FR11-15):**
- FR11: Viewers can watch the currently selected video stream
- FR12: Viewers can see video in full-screen mode
- FR13: Viewers can control video volume
- FR14: System can play HLS streams via Dispatcharr proxy
- FR15: System can recover from temporary stream interruptions

**Real-Time Synchronization (FR16-20):**
- FR16: System can broadcast channel changes to all connected viewers
- FR17: Viewers can receive channel updates in real-time
- FR18: Viewer's video player can automatically switch to new channel
- FR19: System can detect and recover from WebSocket disconnections
- FR20: New viewers can receive current channel state on connect

**User Interface (FR21-26):**
- FR21: Interface can adapt to desktop screen sizes
- FR22: Interface can adapt to mobile screen sizes
- FR23: Interface can adapt to TV screen sizes (10-foot UI)
- FR24: Users can navigate using keyboard/remote controls
- FR25: Video controls can auto-hide during playback
- FR26: Users can see loading/buffering state indicators

### NonFunctional Requirements

**Performance (NFR1-5):**
- NFR1: Stream playback begins within 3 seconds of channel selection
- NFR2: Channel switch completes within 2 seconds for all viewers
- NFR3: WebSocket messages deliver within 500ms
- NFR4: UI remains responsive during stream loading (no freezing)
- NFR5: Initial page load under 3 seconds on 4G connection

**Reliability (NFR6-8):**
- NFR6: WebSocket auto-reconnects within 5 seconds of connection loss
- NFR7: Video player recovers from temporary stream interruptions without user action
- NFR8: App remains functional if Dispatcharr API is temporarily unavailable (graceful degradation)

**Integration (NFR9-11):**
- NFR9: Compatible with Dispatcharr API v0.15+ endpoints
- NFR10: Supports HLS streams from Dispatcharr proxy
- NFR11: Handles Dispatcharr channel UUID format

**Usability - 10-Foot UI (NFR12-15):**
- NFR12: All interactive elements have minimum 44px touch/focus targets
- NFR13: Text readable from 10 feet (minimum 24px for body text)
- NFR14: High contrast between text and background
- NFR15: Full keyboard/D-pad navigation without mouse required

### Additional Requirements

**From Architecture - Starter Template & Project Initialization:**
- Project uses Vite React-TS with SWC template for frontend (npm create vite@latest frontend -- --template react-swc-ts)
- Backend uses FastAPI with uv package manager (uv init)
- Technology versions: Python 3.13+, React 19, Vite 6, Tailwind CSS 4, Zustand 5.0.9+, Vidstack 1.12.13+, FastAPI 0.115+

**From Architecture - Infrastructure Requirements:**
- Single Docker container serving both frontend static files and backend
- NPM (Nginx Proxy Manager) for SSL and routing (already deployed)
- Backend proxies Dispatcharr API via Wireguard VPN (10.8.0.2:9191)
- Streams exposed publicly via streams.domain.com
- NPM proxy configuration: streams.domain.com → 10.8.0.2:9191 (path: /proxy/ts/stream/* only)

**From Architecture - Technical Decisions Impacting Implementation:**
- JWT with 7-day expiration, stored in localStorage
- In-memory channel state (Python dict) - state resets on restart
- WebSocket JSON messages for real-time sync with specific message types defined
- Hardcoded credentials in environment variables for MVP
- shadcn/ui for component library (copy-paste, full ownership)
- Zustand for state management (lightweight, no boilerplate)
- Native browser focus management with Tailwind states for 10-foot UI

**From Architecture - Environment Configuration:**
- Frontend: VITE_API_URL, VITE_WS_URL, VITE_STREAM_BASE_URL
- Backend: DISPATCHARR_URL, JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, VIEWER_USERNAME, VIEWER_PASSWORD

**From Architecture - API Boundaries:**
- POST /api/auth/token - Login, returns JWT (no auth required)
- GET /api/channels - Fetch channel list from Dispatcharr (JWT required)
- GET /api/channels/current - Get current channel (JWT required)
- PUT /api/channels/current - Set current channel, broadcasts to WS (Admin JWT required)
- WS /api/ws - Real-time channel updates (JWT via query param)

**From Architecture - WebSocket Message Types:**
- Server → Client: {"type": "channel_update", "channel": {...}}
- Server → Client: {"type": "connection_ack", "currentChannel": {...} | null}
- Client → Server: {"type": "ping"}

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 1 | User authentication with username/password |
| FR2 | Epic 1 | Admin/viewer role distinction |
| FR3 | Epic 1 | Admin access to channel management |
| FR4 | Epic 1 | Viewer access to video player |
| FR5 | Epic 1 | JWT session persistence |
| FR6 | Epic 2 | Admin views channel list |
| FR7 | Epic 3 | Admin selects channel to broadcast |
| FR8 | Epic 3 | Admin sees current channel |
| FR9 | Epic 3 | Admin can change channel anytime |
| FR10 | Epic 2 | Fetch lineup from Dispatcharr API |
| FR11 | Epic 2 | Viewers watch video stream |
| FR12 | Epic 2 | Full-screen video mode |
| FR13 | Epic 2 | Volume control |
| FR14 | Epic 2 | HLS stream playback |
| FR15 | Epic 2 | Stream interruption recovery |
| FR16 | Epic 3 | Broadcast channel changes to viewers |
| FR17 | Epic 3 | Viewers receive real-time updates |
| FR18 | Epic 3 | Auto-switch to new channel |
| FR19 | Epic 3 | WebSocket disconnect recovery |
| FR20 | Epic 3 | New viewers get current channel on connect |
| FR21 | Epic 4 | Desktop layout adaptation |
| FR22 | Epic 4 | Mobile layout adaptation |
| FR23 | Epic 4 | TV/10-foot UI adaptation |
| FR24 | Epic 4 | Keyboard/remote navigation |
| FR25 | Epic 4 | Auto-hide video controls |
| FR26 | Epic 4 | Loading/buffering indicators |

**Coverage:** 26/26 FRs mapped (100%)

## Epic List

### Epic 1: Project Foundation & Authentication
Users can securely access the application with role-based permissions (admin vs viewer).

**FRs covered:** FR1, FR2, FR3, FR4, FR5
**Additional:** Project scaffolding (Vite + FastAPI), environment setup

### Epic 2: Channel Browsing & Video Playback
Users can browse available channels and watch HLS video streams.

**FRs covered:** FR6, FR10, FR11, FR12, FR13, FR14, FR15
**Additional:** Dispatcharr API integration, Vidstack player setup

### Epic 3: Admin Channel Control & Real-Time Sync
Admin selects a channel and all connected viewers automatically switch to watch it together.

**FRs covered:** FR7, FR8, FR9, FR16, FR17, FR18, FR19, FR20
**Additional:** WebSocket infrastructure, connection status indicator

### Epic 4: Responsive & 10-Foot UI Experience
Users enjoy optimized experience on desktop, mobile, and TV with proper navigation and controls.

**FRs covered:** FR21, FR22, FR23, FR24, FR25, FR26
**NFRs addressed:** NFR12, NFR13, NFR14, NFR15

### Epic 5: Production Deployment
Friends can access the app at iptv.domain.com without VPN or technical setup.

**FRs covered:** None directly (infrastructure)
**Additional:** Docker containerization, NPM proxy configuration, environment variables

---

## Epic 1: Project Foundation & Authentication

Users can securely access the application with role-based permissions (admin vs viewer).

### Story 1.1: Project Scaffolding & Development Environment

As a developer,
I want a fully configured project with frontend and backend structure,
So that I can immediately start building features.

**Acceptance Criteria:**

**Given** a fresh project directory
**When** I run the setup commands
**Then** frontend initializes with Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui
**And** backend initializes with FastAPI + uv + python-jose
**And** both `npm run dev` and `uv run uvicorn` start without errors
**And** project structure matches Architecture document layout

### Story 1.2: JWT Authentication Backend

As a user,
I want to authenticate with my credentials,
So that I can access the application securely.

**Acceptance Criteria:**

**Given** valid admin credentials (from env vars)
**When** I POST to `/api/auth/token` with username/password
**Then** I receive a JWT token with 7-day expiration containing role claim
**And** the response includes `{"access_token": "...", "token_type": "bearer", "role": "admin"}`

**Given** valid viewer credentials
**When** I POST to `/api/auth/token`
**Then** I receive a JWT with role="viewer"

**Given** invalid credentials
**When** I POST to `/api/auth/token`
**Then** I receive 401 Unauthorized with `{"detail": "Invalid credentials"}`

### Story 1.3: Login UI & Auth State Management

As a user,
I want a login form to enter my credentials,
So that I can access the app from any device.

**Acceptance Criteria:**

**Given** I am not logged in
**When** I visit the app
**Then** I see a login form with username and password fields

**Given** I enter valid credentials and submit
**When** the login succeeds
**Then** the JWT is stored in localStorage
**And** I am redirected to the main app view
**And** authStore contains token and role

**Given** I enter invalid credentials
**When** I submit
**Then** I see an error message "Invalid credentials"
**And** I remain on the login form

### Story 1.4: Protected Routes & Role-Based Access

As the system,
I want to enforce authentication and role-based access,
So that only authorized users access appropriate features.

**Acceptance Criteria:**

**Given** I have a valid JWT stored
**When** I visit the app
**Then** I bypass the login form and see the main view

**Given** I am logged in as admin
**When** the app renders
**Then** I can access admin controls (channel selection)

**Given** I am logged in as viewer
**When** the app renders
**Then** I see the video player but not admin channel controls

**Given** my JWT is expired or invalid
**When** I make an API request
**Then** I am redirected to the login form
**And** localStorage is cleared

---

## Epic 2: Channel Browsing & Video Playback

Users can browse available channels and watch HLS video streams.

### Story 2.1: Dispatcharr Channel API Proxy

As the system,
I want to fetch the channel lineup from Dispatcharr,
So that users can see available channels.

**Acceptance Criteria:**

**Given** the backend is running with DISPATCHARR_URL configured
**When** an authenticated user calls GET `/api/channels`
**Then** the backend proxies to Dispatcharr `/hdhr/lineup.json`
**And** returns the channel list as JSON array with channelId, name, and streamUrl

**Given** Dispatcharr is unreachable
**When** GET `/api/channels` is called
**Then** return 503 with `{"detail": "Channel service unavailable"}`

### Story 2.2: Channel List UI Component

As a user,
I want to see a list of available channels,
So that I can know what's available to watch.

**Acceptance Criteria:**

**Given** I am logged in
**When** the main view loads
**Then** I see a channel list fetched from `/api/channels`
**And** each channel displays its name
**And** loading state shows while fetching

**Given** the channel fetch fails
**When** the error is caught
**Then** I see an error message "Unable to load channels"
**And** a retry button is available

### Story 2.3: Video Player with HLS Support

As a viewer,
I want to watch video streams in a full-featured player,
So that I can enjoy the content.

**Acceptance Criteria:**

**Given** a stream URL is available
**When** the VideoPlayer component mounts
**Then** Vidstack player loads and plays the HLS stream
**And** player shows loading state while buffering

**Given** I am watching a stream
**When** I click the fullscreen button
**Then** the video enters fullscreen mode (FR12)

**Given** I am watching a stream
**When** I adjust the volume slider
**Then** the audio volume changes accordingly (FR13)

### Story 2.4: Stream Playback & Error Recovery

As a viewer,
I want the stream to recover from interruptions,
So that I don't have to manually refresh.

**Acceptance Criteria:**

**Given** I am watching a stream
**When** the stream temporarily interrupts (network blip)
**Then** Vidstack attempts automatic recovery
**And** playback resumes without user action (FR15)

**Given** a stream completely fails to load
**When** the error persists after retries
**Then** I see an error overlay "Stream unavailable"
**And** I can see the channel list to pick another

---

## Epic 3: Admin Channel Control & Real-Time Sync

Admin selects a channel and all connected viewers automatically switch to watch it together.

### Story 3.1: Channel State Management Backend

As the system,
I want to track the currently selected channel,
So that all viewers can be synchronized.

**Acceptance Criteria:**

**Given** the backend is running
**When** GET `/api/channels/current` is called with valid JWT
**Then** return the current channel object or null if none selected

**Given** I am logged in as admin
**When** I PUT `/api/channels/current` with a channel object
**Then** the channel state updates in memory
**And** response confirms the update with the channel object

**Given** I am logged in as viewer
**When** I PUT `/api/channels/current`
**Then** I receive 403 Forbidden

### Story 3.2: WebSocket Server Infrastructure

As the system,
I want to maintain WebSocket connections with all clients,
So that I can broadcast channel updates in real-time.

**Acceptance Criteria:**

**Given** a client connects to WS `/api/ws?token=<jwt>`
**When** the connection is established
**Then** the server validates the JWT
**And** adds the connection to the active connections set
**And** sends `{"type": "connection_ack", "currentChannel": <channel|null>}`

**Given** a client's JWT is invalid or expired
**When** they attempt to connect
**Then** the WebSocket connection is rejected

**Given** an admin changes the channel via PUT `/api/channels/current`
**When** the state updates
**Then** broadcast `{"type": "channel_update", "channel": {...}}` to all connected clients

### Story 3.3: Admin Channel Selection UI

As an admin,
I want to select a channel from the list,
So that all viewers switch to that channel.

**Acceptance Criteria:**

**Given** I am logged in as admin
**When** I view the channel list
**Then** I see a "Select" or clickable action on each channel

**Given** I click to select a channel
**When** the selection is confirmed
**Then** PUT `/api/channels/current` is called
**And** the current channel indicator updates
**And** my local video player switches to that stream

**Given** a channel is currently selected
**When** I view the channel list
**Then** the current channel is visually highlighted

### Story 3.4: WebSocket Client & Auto-Sync

As a viewer,
I want my player to automatically switch channels,
So that I stay in sync with what the admin selects.

**Acceptance Criteria:**

**Given** I am logged in and the app loads
**When** the main view mounts
**Then** useWebSocket hook connects to `/api/ws` with my JWT
**And** on connection_ack, channelStore updates with currentChannel
**And** VideoPlayer loads that stream

**Given** I am watching a stream
**When** the admin changes the channel
**Then** I receive a channel_update message
**And** channelStore updates automatically
**And** VideoPlayer switches to the new stream seamlessly

### Story 3.5: Connection Status & Auto-Reconnect

As a viewer,
I want to know my connection status and auto-reconnect if dropped,
So that I don't miss channel changes.

**Acceptance Criteria:**

**Given** I am connected via WebSocket
**When** the connection is healthy
**Then** ConnectionStatus shows "Connected" indicator (green)

**Given** my WebSocket disconnects unexpectedly
**When** the disconnect is detected
**Then** ConnectionStatus shows "Reconnecting..." (yellow)
**And** useWebSocket attempts reconnection with exponential backoff
**And** reconnection succeeds within 5 seconds (NFR6)

**Given** I successfully reconnect
**When** connection_ack is received
**Then** channelStore syncs with current channel
**And** VideoPlayer updates if channel changed while disconnected

---

## Epic 4: Responsive & 10-Foot UI Experience

Users enjoy optimized experience on desktop, mobile, and TV with proper navigation and controls.

### Story 4.1: Responsive Layout System

As a user,
I want the interface to adapt to my screen size,
So that I can use the app on any device.

**Acceptance Criteria:**

**Given** I am on desktop (>1024px)
**When** the app renders
**Then** I see full layout with channel list sidebar visible
**And** video player takes remaining space

**Given** I am on tablet (768-1024px)
**When** the app renders
**Then** I see simplified layout with collapsible channel list

**Given** I am on mobile (<768px)
**When** the app renders
**Then** I see viewer-focused layout with minimal controls
**And** channel list accessible via menu/overlay

### Story 4.2: 10-Foot TV UI Adaptation

As a TV user,
I want large, readable text and focus indicators,
So that I can see and navigate from my couch.

**Acceptance Criteria:**

**Given** I am on a TV browser or large screen
**When** the app renders
**Then** body text is minimum 24px (NFR13)
**And** all interactive elements are minimum 44px touch/focus targets (NFR12)
**And** high contrast is maintained between text and background (NFR14)

**Given** 10-foot UI mode is active
**When** elements receive focus
**Then** clear visible focus indicators are shown (ring/outline)

### Story 4.3: Keyboard & D-pad Navigation

As a user,
I want to navigate entirely with keyboard or remote,
So that I don't need a mouse.

**Acceptance Criteria:**

**Given** I am on the channel list
**When** I press arrow keys (up/down)
**Then** focus moves between channel items

**Given** a channel is focused
**When** I press Enter/Space
**Then** the channel is selected (if admin) or focused for info

**Given** I am watching video
**When** I press arrow keys (left/right)
**Then** volume adjusts or seek (configurable)

**Given** any screen
**When** I press Tab
**Then** focus moves logically through interactive elements (NFR15)

### Story 4.4: Auto-Hide Video Controls

As a viewer,
I want video controls to hide during playback,
So that I can watch without UI clutter.

**Acceptance Criteria:**

**Given** I am watching a video
**When** I haven't interacted for 3 seconds
**Then** video controls fade out
**And** cursor hides (on desktop)

**Given** controls are hidden
**When** I move the mouse or press a key
**Then** controls fade back in
**And** the 3-second idle timer resets

**Given** I am on a touch device
**When** I tap the video area
**Then** controls toggle visibility

### Story 4.5: Loading & Buffering States

As a user,
I want to see loading indicators,
So that I know the app is working.

**Acceptance Criteria:**

**Given** a channel list is loading
**When** the fetch is in progress
**Then** I see a skeleton loader or spinner

**Given** the video is buffering
**When** playback is paused for buffering
**Then** I see a loading spinner overlay on the video
**And** playback resumes automatically when buffered

**Given** a channel switch is in progress
**When** the new stream is loading
**Then** I see a transition indicator
**And** the previous frame doesn't freeze awkwardly

---

## Epic 5: Production Deployment

Friends can access the app at iptv.domain.com without VPN or technical setup.

### Story 5.1: Docker Container Build

As a developer,
I want a Docker container that runs the complete app,
So that I can deploy it easily to my VPS.

**Acceptance Criteria:**

**Given** the Dockerfile in project root
**When** I run `docker build -t iptv-viewer .`
**Then** frontend builds with Vite and outputs to static folder
**And** backend installs dependencies via uv
**And** final image serves both frontend static files and API on port 8080

**Given** a built container
**When** I run `docker run -p 8080:8080 --env-file .env iptv-viewer`
**Then** the app starts and is accessible at localhost:8080
**And** all environment variables are loaded correctly

### Story 5.2: Docker Compose & Environment Configuration

As a developer,
I want docker-compose for easy deployment,
So that I can manage the app alongside my other services.

**Acceptance Criteria:**

**Given** docker-compose.yml in project root
**When** I run `docker-compose up -d`
**Then** the container builds (if needed) and starts
**And** environment variables are loaded from .env file
**And** container restarts automatically on failure

**Given** .env.example in project root
**When** a new developer clones the repo
**Then** they can copy to .env and fill in their values
**And** all required variables are documented

### Story 5.3: NPM Proxy Configuration & SSL

As an admin,
I want the app accessible via HTTPS at my domain,
So that friends can access it securely.

**Acceptance Criteria:**

**Given** NPM (Nginx Proxy Manager) is running
**When** I configure a proxy host for iptv.domain.com
**Then** requests route to the Docker container on port 8080
**And** SSL certificate is provisioned via Let's Encrypt
**And** WebSocket connections upgrade correctly at /api/ws

**Given** streams.domain.com is configured in NPM
**When** video player requests /proxy/ts/stream/{uuid}
**Then** NPM proxies to Dispatcharr at 10.8.0.2:9191
**And** HLS streams play correctly in the browser

---

## Epic 6: UI Polish & EPG Integration

Users enjoy a refined viewing experience with a slimmer header showing current channel and program info, role-appropriate channel access, and visual polish.

**FRs covered:** None (enhancement work)
**New capabilities:** EPG now-playing display, role-based UI, header redesign

### Story 6.1: Header Redesign & Branding

As a user,
I want a slimmer, cleaner header with the current channel displayed,
So that more screen space is dedicated to video content.

**Acceptance Criteria:**

**Given** I am viewing the app
**When** the header renders
**Then** header height is reduced by 50% (p-2 padding instead of p-4)
**And** title displays "Jon's place" instead of "IPTV Viewer"
**And** current channel name is displayed in the header
**And** the layout remains responsive across breakpoints

**Given** no channel is selected
**When** viewing the header
**Then** channel name area shows "No channel selected" or is empty

### Story 6.2: EPG Backend Service

As the system,
I want to fetch and cache EPG data from Dispatcharr,
So that current program information can be displayed to users.

**Acceptance Criteria:**

**Given** the backend is running with DISPATCHARR_URL configured
**When** GET `/api/epg/now-playing?channel_id=<uuid>` is called
**Then** return current program info for that channel
**And** response includes title, startTime, endTime
**And** optionally includes nextProgram info

**Given** EPG data is not cached or cache is stale (>24h)
**When** the endpoint is called
**Then** fetch fresh XMLTV from Dispatcharr `/xmltv.php`
**And** parse and cache the data for 24 hours

**Given** Dispatcharr is unreachable
**When** the endpoint is called
**Then** return cached data if available, or 503 with graceful error

**Given** no EPG data exists for the channel
**When** the endpoint is called
**Then** return `{"channelId": "...", "currentProgram": null}`

### Story 6.3: EPG Display in Header

As a user,
I want to see what's currently playing in the header,
So that I know what program is on without checking a guide.

**Acceptance Criteria:**

**Given** a channel is selected and EPG data is available
**When** viewing the header
**Then** current program title displays next to channel name
**And** format is: "Channel Name - Program Title"

**Given** a channel is selected but no EPG data exists
**When** viewing the header
**Then** only channel name displays (no error shown)

**Given** the admin changes the channel
**When** the channel switches
**Then** EPG info updates to show new channel's current program

### Story 6.4: Viewer Role - Remove Channel List

As a viewer,
I want a distraction-free viewing experience,
So that I can focus on the video content.

**Acceptance Criteria:**

**Given** I am logged in as viewer
**When** the main view renders
**Then** I do NOT see a channel list or hamburger menu
**And** video player takes full width (minus header)
**And** I cannot access channel selection

**Given** I am logged in as viewer on any breakpoint (mobile/tablet/desktop)
**When** the main view renders
**Then** channel list is hidden on ALL screen sizes

### Story 6.5: Admin Role - Hamburger Menu

As an admin,
I want channel selection via a hamburger menu,
So that the video has more screen space when not selecting channels.

**Acceptance Criteria:**

**Given** I am logged in as admin on ANY breakpoint (including desktop)
**When** the main view renders
**Then** I see a hamburger menu button in the header
**And** video player takes full width (minus header)
**And** channel list is NOT pinned to the side

**Given** I click the hamburger menu
**When** the menu opens
**Then** channel list appears as a slide-out drawer from the right
**And** I can select a channel
**And** clicking outside or pressing Escape closes the drawer

**Given** I select a channel from the drawer
**When** selection completes
**Then** drawer closes automatically
**And** video switches to selected channel

### Story 6.6: Logout Button Fix

As a user,
I want the logout button to display correctly,
So that text doesn't overflow the button boundaries.

**Acceptance Criteria:**

**Given** I am viewing the header on any screen size
**When** the logout button renders
**Then** text "Logout" fits within button boundaries
**And** no text overflow or clipping occurs
**And** button maintains minimum touch target (44px height)

**Given** I am on a narrow viewport
**When** header space is constrained
**Then** logout button adjusts appropriately (icon-only or wrapped)

### Story 6.7: Mobile Landscape Auto-Fullscreen

As a mobile user,
I want the video to automatically enter fullscreen when I rotate my device to landscape,
So that I get an immersive viewing experience without manual interaction.

**Acceptance Criteria:**

**Given** I am viewing video on a mobile device in portrait mode
**When** I rotate my device to landscape orientation
**Then** the video player automatically enters fullscreen mode
**And** the transition is smooth without jarring layout shifts

**Given** I am in auto-fullscreen mode (landscape)
**When** I rotate my device back to portrait orientation
**Then** the video exits fullscreen automatically
**And** the normal app layout is restored

**Given** I am on a desktop or tablet (>768px)
**When** I would trigger orientation change
**Then** auto-fullscreen behavior is disabled (desktop/tablet excluded)

**Given** auto-fullscreen is triggered
**When** entering fullscreen
**Then** video controls remain accessible
**And** I can manually exit fullscreen if desired (tap or swipe)

---

## Epic 7: ErsatzTV Multi-Channel Movie View

Users can browse and watch continuous movie channels from ErsatzTV with a full EPG grid interface, independent from the live TV feature.

**Key Features:**
- Separate `/ersatztv` route (independent from live TV)
- Full EPG grid showing all channels with current/next programmes
- Independent browsing (no multi-client sync)
- HLS streaming via vidstack player
- M3U channel parsing and XMLTV programme data

**Technical Decisions:**
- Streaming Format: HLS Segmenter (best program boundary handling)
- Player: vidstack (already installed)
- Channel Data: M3U parsing (more metadata than HDHomeRun JSON)
- Sync Mode: Independent browsing (movie night sync deferred to post-MVP)

**Environment Variables:**
- `ERSATZTV_M3U_URL` - M3U playlist URL
- `ERSATZTV_XMLTV_URL` - XMLTV EPG URL
- `ERSATZTV_BASE_URL` - Base URL for ErsatzTV server

---

### Story 7.1: ErsatzTV Configuration & Models

As a developer,
I want ErsatzTV configuration and data models in place,
So that I can build services that interact with ErsatzTV.

**Acceptance Criteria:**

**Given** the backend configuration
**When** ErsatzTV environment variables are set
**Then** `settings.ersatztv_m3u_url`, `settings.ersatztv_xmltv_url`, and `settings.ersatztv_base_url` are accessible

**Given** the models module
**When** I import from `app.models.ersatztv`
**Then** I have access to `EPGChannel` and `Programme` Pydantic models
**And** models support JSON serialization with camelCase field names

---

### Story 7.2: M3U Parser Service

As the system,
I want to parse ErsatzTV's M3U playlist,
So that I can display available movie channels.

**Acceptance Criteria:**

**Given** the M3U parser service
**When** I call `parse_m3u_playlist()`
**Then** it fetches the M3U from `ERSATZTV_M3U_URL`
**And** extracts channel_id, name, stream_url, logo_url, number, group for each channel

**Given** M3U data was fetched within the last hour
**When** I call `parse_m3u_playlist()` again
**Then** it returns cached data without re-fetching

**Given** ErsatzTV is unreachable
**When** I call `parse_m3u_playlist()` and cache exists
**Then** it returns stale cached data gracefully

---

### Story 7.3: XMLTV Parser Service

As the system,
I want to parse ErsatzTV's XMLTV EPG data,
So that I can display programme schedules.

**Acceptance Criteria:**

**Given** the XMLTV parser service
**When** I call `parse_xmltv()`
**Then** it fetches the XMLTV from `ERSATZTV_XMLTV_URL`
**And** extracts id, channel_id, title, description, start, stop, category for each programme
**And** converts all times to UTC

**Given** XMLTV data was fetched within the last 5 minutes
**When** I call `parse_xmltv()` again
**Then** it returns cached data without re-fetching

---

### Story 7.4: EPG Service Layer

As the system,
I want a unified EPG service layer,
So that I can easily query channels and programmes.

**Acceptance Criteria:**

**Given** the EPG service
**When** I call `get_channels()`
**Then** it returns all ErsatzTV channels from M3U data

**Given** the EPG service
**When** I call `get_current_programme(channel_id)`
**Then** it returns the currently airing programme and next upcoming programme

**Given** the EPG service
**When** I call `get_programmes_by_channel(channel_id, hours=6)`
**Then** it returns programmes for the specified time window

---

### Story 7.5: HLS Proxy Service

As the system,
I want to proxy HLS streams through the backend,
So that ErsatzTV URLs are not exposed to clients.

**Acceptance Criteria:**

**Given** an HLS manifest URL from ErsatzTV
**When** I call `rewrite_manifest(manifest_content)`
**Then** segment URLs are rewritten to use `/api/ersatztv/segments/{encoded_url}`

**Given** a base64-encoded segment URL
**When** I call `decode_url(encoded_url)`
**Then** it returns the original ErsatzTV segment URL

**Given** HLS streams use nested variant playlists
**When** the manifest is rewritten
**Then** nested m3u8 URLs are also proxied correctly

---

### Story 7.6: ErsatzTV API Endpoints

As a frontend developer,
I want REST API endpoints for ErsatzTV data,
So that the React app can fetch channels and programmes.

**Acceptance Criteria:**

**Given** an authenticated user
**When** I call `GET /api/ersatztv/channels`
**Then** I receive a list of all ErsatzTV channels

**Given** an authenticated user
**When** I call `GET /api/ersatztv/programmes/{channel_id}?hours=6`
**Then** I receive programmes for that channel within the time window

**Given** an authenticated user
**When** I call `GET /api/ersatztv/current/{channel_id}`
**Then** I receive current and next programme for that channel

**Given** an authenticated user
**When** I call `GET /api/ersatztv/stream/{channel_id}`
**Then** I receive the proxied HLS manifest with rewritten URLs

**Given** a valid encoded segment URL
**When** I call `GET /api/ersatztv/segments/{encoded_url}`
**Then** the segment is fetched from ErsatzTV and streamed to client

**Given** a channel_id
**When** I call `GET /api/ersatztv/logos/{channel_id}`
**Then** the channel logo is fetched from ErsatzTV and returned

---

### Story 7.7: React Router Setup

As a user,
I want to navigate between live TV and ErsatzTV views,
So that I can access both features from the same app.

**Acceptance Criteria:**

**Given** I am authenticated
**When** I navigate to `/`
**Then** I see the existing live TV MainView

**Given** I am authenticated
**When** I navigate to `/ersatztv`
**Then** I see the ErsatzTV view

**Given** I am not authenticated
**When** I navigate to either route
**Then** I am redirected to the login page

**Given** I am on the live TV view
**When** I click the ErsatzTV navigation link
**Then** I navigate to `/ersatztv`

---

### Story 7.8: Vidstack HLS Player Component

As a user,
I want to watch ErsatzTV HLS streams,
So that I can enjoy movie channels.

**Acceptance Criteria:**

**Given** the HLSVideoPlayer component with a stream URL
**When** the component mounts
**Then** vidstack loads and plays the HLS stream

**Given** I am watching a stream
**When** I use the video controls
**Then** I can play/pause, adjust volume, mute, and toggle fullscreen

**Given** the stream is buffering
**When** playback is paused for buffering
**Then** I see a loading indicator

**Given** the stream fails to load
**When** an error occurs
**Then** I see an error message

---

### Story 7.9: ErsatzTV Store & API Service

As a frontend developer,
I want Zustand store and API service for ErsatzTV,
So that components can access ErsatzTV data.

**Acceptance Criteria:**

**Given** the ersatztvStore
**When** I access state
**Then** I have: channels, selectedChannel, programmes, loading, error

**Given** the ersatztvApi service
**When** I call `fetchChannels()`
**Then** it fetches from `/api/ersatztv/channels` with auth token

**Given** the ersatztvApi service
**When** I call `getStreamUrl(channelId)`
**Then** it returns the proxied HLS manifest URL

---

### Story 7.10: EPG Channel Sidebar

As a user,
I want to see a list of ErsatzTV channels,
So that I can browse and select what to watch.

**Acceptance Criteria:**

**Given** the EPG channel sidebar
**When** it renders
**Then** I see all channels with logo, name, and number

**Given** each channel in the list
**When** it renders
**Then** I see the current programme title

**Given** I click on a channel
**When** the click is processed
**Then** that channel is selected and starts playing

**Given** a channel is currently playing
**When** the sidebar renders
**Then** the playing channel is visually highlighted

---

### Story 7.11: EPG Grid Component

As a user,
I want to see an EPG grid of all programmes,
So that I can see what's on now and coming up.

**Acceptance Criteria:**

**Given** the EPG grid
**When** it renders
**Then** I see time slots in 30-minute intervals across the header

**Given** the EPG grid
**When** it renders
**Then** I see channel rows with programmes positioned by time

**Given** the current time
**When** viewing the grid
**Then** I see a "now" marker line at the current time position

**Given** the grid has more content than visible
**When** I scroll horizontally
**Then** I can see future programmes

**Given** I click on a programme box
**When** the click is processed
**Then** the programme details modal opens

---

### Story 7.12: Programme Details Modal

As a user,
I want to see full programme details,
So that I can decide if I want to watch it.

**Acceptance Criteria:**

**Given** I click on a programme in the grid
**When** the modal opens
**Then** I see title, time range, description, and category

**Given** the modal is open
**When** I click the "Watch" button
**Then** the modal closes and that channel starts playing

**Given** the modal is open
**When** I click outside the modal or press Escape
**Then** the modal closes

---

### Story 7.13: ErsatzTV Main View

As a user,
I want a complete ErsatzTV viewing experience,
So that I can browse and watch movie channels.

**Acceptance Criteria:**

**Given** I navigate to `/ersatztv`
**When** the view renders
**Then** I see a header with navigation back to live TV

**Given** the main view
**When** it renders
**Then** I see the HLS video player

**Given** the main view
**When** it renders
**Then** I see the EPG grid below the video

**Given** programmes are older than 5 minutes
**When** the refresh interval triggers
**Then** programme data is automatically refreshed

**Given** I am on desktop
**When** viewing the layout
**Then** I see the EPG grid in full-width format

**Given** I am on mobile
**When** viewing the layout
**Then** I see a mobile-optimized card layout

---

## Epic 8: Optional Plex Authentication

Users can optionally authenticate using their Plex account if they have access to the host's Plex Media Server. This provides a seamless login experience for friends who are already Plex users.

**Key Features:**
- Environment variable feature flags for both auth methods
- Plex OAuth popup flow for token acquisition
- Backend validation against Plex Media Server
- Automatic role assignment based on configuration
- Coexists with existing credential-based auth (when enabled)

**Environment Variables:**
- `LOCAL_AUTH_ENABLED` - Enable/disable local auth (default: false)
- `PLEX_AUTH_ENABLED` - Enable/disable Plex auth (default: false)
- `PLEX_SERVER_TOKEN` - Admin's Plex server token for user validation
- `PLEX_SERVER_MACHINE_ID` - Plex server machine identifier
- `PLEX_DEFAULT_ROLE` - Default role for Plex users (viewer/admin)

---

### Story 8.1: Plex Authentication Backend Service

As a developer,
I want a Plex authentication service in the backend,
So that users can authenticate via their Plex accounts.

**Acceptance Criteria:**

**Given** `PLEX_AUTH_ENABLED=true` in environment
**When** POST `/api/auth/plex` is called with `{authToken: "..."}`
**Then** backend validates token via Plex API `https://plex.tv/users/account`
**And** checks user has access to configured Plex server
**And** returns JWT with role claim on success

**Given** `PLEX_AUTH_ENABLED=false` or not set
**When** POST `/api/auth/plex` is called
**Then** return 404 Not Found

**Given** valid Plex token but user has no server access
**When** authentication is attempted
**Then** return 403 Forbidden with "No access to Plex server"

**Given** invalid or expired Plex token
**When** authentication is attempted
**Then** return 401 Unauthorized

---

### Story 8.2: Plex OAuth Token Acquisition

As a user,
I want to click "Sign in with Plex" and authenticate via Plex popup,
So that I don't need to remember separate credentials.

**Acceptance Criteria:**

**Given** `PLEX_AUTH_ENABLED=true`
**When** the login page renders
**Then** I see a "Sign in with Plex" button below the credential form

**Given** I click "Sign in with Plex"
**When** the popup opens
**Then** I see Plex's official authentication page
**And** I can enter my Plex credentials

**Given** I successfully authenticate with Plex
**When** the popup closes
**Then** the auth token is sent to `/api/auth/plex`
**And** on success, I am logged in with appropriate role

**Given** I cancel the Plex popup
**When** the popup closes without auth
**Then** I remain on the login page with no error

---

### Story 8.3: Plex User Role Assignment

As an admin,
I want to configure how Plex users are assigned roles,
So that I can control access levels automatically.

**Acceptance Criteria:**

**Given** `PLEX_DEFAULT_ROLE=viewer` (or not set)
**When** a new Plex user authenticates
**Then** they are assigned the "viewer" role

**Given** `PLEX_DEFAULT_ROLE=admin`
**When** a new Plex user authenticates
**Then** they are assigned the "admin" role

**Given** the Plex user is the server owner (matching `PLEX_SERVER_TOKEN` owner)
**When** they authenticate
**Then** they are always assigned "admin" role regardless of default

---

### Story 8.4: Conditional Login UI

As a user,
I want the login page to show appropriate options based on configuration,
So that I see only relevant authentication methods.

**Acceptance Criteria:**

**Given** `LOCAL_AUTH_ENABLED=false` and `PLEX_AUTH_ENABLED=false`
**When** the login page renders
**Then** I see an error message "No authentication methods configured"

**Given** `LOCAL_AUTH_ENABLED=true` and `PLEX_AUTH_ENABLED=false`
**When** the login page renders
**Then** I see only the username/password form
**And** no Plex sign-in option is visible

**Given** `LOCAL_AUTH_ENABLED=false` and `PLEX_AUTH_ENABLED=true`
**When** the login page renders
**Then** I see only the "Sign in with Plex" button
**And** no credential form is visible

**Given** `LOCAL_AUTH_ENABLED=true` and `PLEX_AUTH_ENABLED=true`
**When** the login page renders
**Then** I see both the credential form and "Sign in with Plex" button
**And** a visual separator ("or") between the options

**Given** either auth method succeeds
**When** I complete authentication
**Then** I am redirected to the main app experience

---

### Story 8.5: Feature-Flagged Local Authentication

As a deployer,
I want local (credential-based) authentication to be feature-flagged,
So that I can disable it when using Plex-only authentication.

**Acceptance Criteria:**

**Given** `LOCAL_AUTH_ENABLED=false` or not set (default)
**When** POST `/api/auth/token` is called with credentials
**Then** return 404 Not Found

**Given** `LOCAL_AUTH_ENABLED=true`
**When** POST `/api/auth/token` is called with valid credentials
**Then** authentication proceeds as normal (existing behavior)

**Given** both `LOCAL_AUTH_ENABLED=false` and `PLEX_AUTH_ENABLED=false`
**When** the backend starts
**Then** log a warning: "No authentication methods enabled"

**Given** `LOCAL_AUTH_ENABLED=false` and `PLEX_AUTH_ENABLED=true`
**When** the login page renders
**Then** only "Sign in with Plex" button is shown
**And** no credential form is visible

---

## Epic 9: Comprehensive Logging & Observability

Users and operators benefit from comprehensive logging across the application for debugging, monitoring, and operational visibility.

**Key Features:**
- Backend logging with loguru (structured JSON output)
- Frontend logging utility with configurable levels
- Request/response logging for API calls
- WebSocket connection lifecycle logging
- Error tracking with full context

**Environment Variables:**
- `LOG_LEVEL` - Backend log level (DEBUG, INFO, WARNING, ERROR)
- `LOG_FORMAT` - Backend format (json or pretty)
- `VITE_LOG_LEVEL` - Frontend log level (debug, info, warn, error)

---

### Story 9.1: Backend Logging Infrastructure

As an operator,
I want structured logging throughout the backend,
So that I can monitor application health and debug issues.

**Acceptance Criteria:**

**Given** the backend starts
**When** logging is initialized
**Then** loguru is configured with level from `LOG_LEVEL` env var
**And** output format respects `LOG_FORMAT` (json or pretty)
**And** startup message is logged

**Given** `LOG_FORMAT=json`
**When** any log message is written
**Then** output is valid JSON with timestamp, level, message, and context

**Given** `LOG_FORMAT=pretty`
**When** any log message is written
**Then** output is human-readable with colors and formatting

---

### Story 9.2: Backend Service Logging

As an operator,
I want all backend services to log their operations,
So that I can trace requests and diagnose issues.

**Acceptance Criteria:**

**Given** any external API call (Dispatcharr, Plex, ErsatzTV)
**When** the call is made
**Then** log the target URL at DEBUG level
**And** log success with result count at INFO level
**And** log failures with error details at ERROR level

**Given** any cache operation (EPG, M3U, XMLTV)
**When** cache is accessed
**Then** log cache hits/misses at DEBUG level
**And** log cache refreshes at INFO level

**Given** channel state changes
**When** admin sets a new channel
**Then** log the change with channel name and user at INFO level

---

### Story 9.3: Backend Router Logging

As an operator,
I want all API endpoints to log requests,
So that I can monitor traffic and errors.

**Acceptance Criteria:**

**Given** any authenticated endpoint
**When** request is processed
**Then** log request method and path at DEBUG level
**And** log user identity for admin operations at DEBUG level

**Given** authentication endpoints
**When** login is attempted
**Then** log username (not password) at DEBUG level
**And** log success with role at INFO level
**And** log failure at WARNING level

**Given** WebSocket connections
**When** client connects or disconnects
**Then** log connection state at INFO level
**And** log authentication failures at WARNING level

---

### Story 9.4: Frontend Logger Utility

As a developer,
I want a structured logging utility for the frontend,
So that I can debug issues consistently.

**Acceptance Criteria:**

**Given** the logger utility is imported
**When** I call `logger.info('context', 'message')`
**Then** output includes timestamp, level, context, and message

**Given** `VITE_LOG_LEVEL=debug`
**When** any log call is made
**Then** all levels (debug, info, warn, error) are output

**Given** `VITE_LOG_LEVEL=error`
**When** debug/info/warn calls are made
**Then** they are suppressed (only errors shown)

**Given** the production build
**When** logger is used
**Then** no performance impact from suppressed log calls

---

### Story 9.5: Frontend API & WebSocket Logging

As a developer,
I want API calls and WebSocket events logged,
So that I can trace communication issues.

**Acceptance Criteria:**

**Given** any API call via `fetchWithAuth`
**When** the call is made
**Then** log endpoint at DEBUG level
**And** log errors at ERROR level with response details

**Given** WebSocket connection
**When** connection state changes
**Then** log connecting/connected/reconnecting/disconnected at INFO level

**Given** WebSocket messages
**When** channel_update is received
**Then** log channel change at DEBUG level

**Given** any unhandled error
**When** error is caught
**Then** log with full error object at ERROR level

---

## Epic 10: Progressive Web App (PWA)

Users can install the app on their devices for a native-like experience with offline-capable shell and enhanced TV integration.

**Key Features:**
- Web App Manifest for installability
- Service Worker for app shell caching
- Standalone display mode (no browser chrome)
- Install prompt UX
- Optimized icons for various platforms

**Technical Approach:**
- Use vite-plugin-pwa for generation
- NetworkFirst strategy for API, CacheFirst for static assets
- Minimal offline support (login state, UI shell)

---

### Story 10.1: PWA Manifest & Icons

As a user,
I want the app to be installable on my device,
So that I can launch it like a native app without browser chrome.

**Acceptance Criteria:**

**Given** I visit the app on mobile or desktop
**When** the browser detects the PWA manifest
**Then** browser shows "Add to Home Screen" option

**Given** the manifest.json file
**When** inspected
**Then** it includes: name, short_name, icons (192x192, 512x512), start_url, display: standalone, theme_color, background_color

**Given** I install the PWA
**When** I launch from home screen
**Then** app opens in standalone mode without browser UI

---

### Story 10.2: Service Worker & Caching

As a user,
I want the app shell to load quickly,
So that I see UI immediately even on slow connections.

**Acceptance Criteria:**

**Given** vite-plugin-pwa is configured
**When** the app builds
**Then** a service worker is generated with precaching for app shell assets

**Given** static assets (JS, CSS, images)
**When** requested after first load
**Then** they are served from cache (CacheFirst strategy)

**Given** API requests
**When** fetching channels or streams
**Then** network is preferred with optional fallback (NetworkFirst)

**Given** the user is offline
**When** they launch the installed PWA
**Then** they see the app shell with "Network unavailable" message

---

### Story 10.3: Install Prompt UX

As a user,
I want to be prompted to install the app,
So that I know the install option exists.

**Acceptance Criteria:**

**Given** I am on a supported browser and haven't installed the PWA
**When** I visit the app
**Then** an unobtrusive install prompt appears (banner or button)

**Given** I click "Install" on the prompt
**When** the browser install flow triggers
**Then** the app is added to my device

**Given** I have already installed or dismissed
**When** I visit again
**Then** the install prompt does not reappear

**Given** I am on a TV browser
**When** viewing the app
**Then** install prompt is keyboard/d-pad accessible

---

## Epic 11: Admin Modal & User Presence

Admins can access a centralized admin modal from both Live TV and ErsatzTV views, providing channel control, real-time user presence monitoring with stream bitrate usage, and placeholders for future admin features.

**Key Features:**
- Unified admin modal accessible from both views with identical functionality
- Channel selection available from any view (control Live TV from ErsatzTV)
- Real-time active user monitoring with separated Live/ErsatzTV sections
- Stream bitrate usage per user and totals
- Placeholder tabs for User Access and Plugins (accessible from any view)
- Admin-only visibility (existing env variable auth)

**Environment Variables:**
- Uses existing `ADMIN_USERNAME`, `ADMIN_PASSWORD` for admin detection

---

### Story 11.1: Admin Modal Component & Tab Structure

As an admin,
I want a modal dialog with multiple tabs,
So that I can access all admin functions from one place.

**Acceptance Criteria:**

**Given** I am logged in as admin
**When** I click the admin button in the header
**Then** a modal opens with tabs: "Channels", "Active Users", "User Access", "Plugins"

**Given** the admin modal is open
**When** I click outside the modal or press Escape
**Then** the modal closes

**Given** I am on the ErsatzTV view
**When** I open the admin modal
**Then** the "Channels" and "Plugins" tabs are hidden (Live TV only)

---

### Story 11.2: Channel Selection Tab (Live TV)

As an admin,
I want to select channels from within the admin modal,
So that channel control is consolidated with other admin functions.

**Acceptance Criteria:**

**Given** I am on Live TV view and open the admin modal
**When** I navigate to the "Channels" tab
**Then** I see the existing channel list component

**Given** I select a channel from the modal
**When** selection completes
**Then** the channel changes for all viewers
**And** the modal closes automatically

---

### Story 11.3: Admin Button in MainView Header

As an admin on Live TV,
I want an admin button replacing the hamburger menu,
So that I can access the admin modal.

**Acceptance Criteria:**

**Given** I am logged in as admin on Live TV
**When** the header renders
**Then** I see an admin icon button (replacing the hamburger menu)
**And** clicking it opens the admin modal

**Given** I am logged in as viewer
**When** the header renders
**Then** I do NOT see the admin button

---

### Story 11.4: Admin Button in ErsatzTVView Header

As an admin on ErsatzTV,
I want the same admin button in the header,
So that I have consistent access to admin functions.

**Acceptance Criteria:**

**Given** I am logged in as admin on ErsatzTV
**When** the header renders
**Then** I see the admin icon button at the same position as Live TV (left side)

**Given** I click the admin button
**When** the modal opens
**Then** only "Active Users" and "User Access" tabs are visible (no Channels/Plugins)

---

### Story 11.5: Active Users & Bitrate Backend

As the system,
I want to track connected users, their activity, and stream bitrate usage,
So that admins can monitor who is watching and bandwidth consumption.

**Acceptance Criteria:**

**Given** a user connects via WebSocket
**When** they are authenticated
**Then** their presence is tracked: userId, username, view (live/ersatztv), currentChannel, connectedSince, estimatedBitrate

**Given** an admin requests active users
**When** GET `/api/admin/active-users` is called
**Then** return structured response with liveUsers, ersatztvUsers, and totals including bitrate

**Given** a user disconnects
**When** their WebSocket closes
**Then** they are removed from the active users list

**Given** a user changes channels
**When** the channel updates
**Then** their tracked currentChannel and estimatedBitrate update

---

### Story 11.6: Active Users Tab UI

As an admin,
I want to see who is currently watching and their bandwidth usage,
So that I can monitor usage and resource consumption.

**Acceptance Criteria:**

**Given** I open the "Active Users" tab
**When** the tab renders
**Then** I see two sections: "Live TV" and "ErsatzTV"
**And** I see total bandwidth summary at the top

**Given** users are connected to Live TV
**When** viewing the Live TV section
**Then** I see each user with: username, current channel, duration, bitrate (e.g., "8.5 Mbps")
**And** I see section subtotal: "2 users • 17.0 Mbps"

**Given** users are connected to ErsatzTV
**When** viewing the ErsatzTV section
**Then** I see each user with: username, current channel, duration, bitrate
**And** I see section subtotal

**Given** no users are connected to a view
**When** viewing that section
**Then** I see "No active users" message

---

### Story 11.7: Placeholder Tabs (User Access & Plugins)

As an admin,
I want placeholder tabs for future features,
So that the UI structure is ready for expansion.

**Acceptance Criteria:**

**Given** I open the "User Access" tab
**When** the tab renders
**Then** I see a placeholder message: "User access management coming soon"

**Given** I am on Live TV and open the admin modal
**When** I navigate to the "Plugins" tab
**Then** I see a placeholder message: "Plugins management coming soon"

**Given** I am on ErsatzTV
**When** I open the admin modal
**Then** the "Plugins" tab is NOT visible