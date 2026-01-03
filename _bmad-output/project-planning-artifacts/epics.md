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
