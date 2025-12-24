# Dispatcharr IPTV Viewer - Research & Implementation Plan

**Research Date:** December 23, 2025
**Researcher:** Mary (Business Analyst)
**Project:** New React-based IPTV Viewer using Dispatcharr backend

---

## Executive Summary

This document outlines a comprehensive implementation plan for a new React-based IPTV viewer that leverages Dispatcharr (deployed on VPS at port 9191) for stream proxying and EPG management. The goal is to create a clean, modern UI without reinventing stream management complexity.

---

## 1. Dispatcharr Capabilities Analysis

### 1.1 Deployed Instance
- **Location:** VPS (vps143066-d2w)
- **Version:** 0.15.1 (Build: 20251222225841)
- **Port:** 9191
- **Technology Stack:** Django + PostgreSQL + Redis + Celery

### 1.2 Key API Endpoints Discovered

**Public Endpoints (No Auth Required):**
```
/hdhr/lineup.json                    - Channel list with stream URLs
/hdhr/discover.json                  - Device discovery info
/hdhr/lineup_status.json             - Lineup status
/hdhr/{profile}/lineup.json          - Profile-specific lineup
/proxy/ts/stream/{channel_id}        - Stream proxy (TS format)
/proxy/ts/status                     - Proxy status
/proxy/ts/status/{channel_id}        - Channel-specific status
```

**Authenticated Endpoints (JWT Required):**
```
/api/accounts/token/                 - Obtain JWT token
/api/accounts/token/refresh/         - Refresh token
/api/channels/channels/              - Channel management
/api/channels/streams/               - Stream sources
/api/channels/profiles/              - Channel profiles
/api/epg/epgdata/                    - EPG program data
/api/epg/sources/                    - EPG sources
```

### 1.3 Stream URL Format
```
http://{host}:9191/proxy/ts/stream/{uuid}
```
Example channels discovered:
- TSN 5: `/proxy/ts/stream/0a394a85-c369-4b08-b083-465f2149fc2d`
- Sportsnet West: `/proxy/ts/stream/f17a1fbb-331c-485c-b018-1a82bccac25f`

### 1.4 Dispatcharr Features Relevant to Project
- **M3U Proxy:** Handles stream proxying and failover
- **EPG Support:** XMLTV format, auto-matching
- **HDHomeRun Emulation:** Works with Plex/Jellyfin
- **Stream Profiles:** Multiple output configurations
- **No VPN Required:** Streams are already proxied through Dispatcharr on VPS

---

## 2. Existing iptv_viewer Analysis

### 2.1 Current Architecture
- **Backend:** FastAPI (Python)
- **Frontend:** Alpine.js + Tailwind CSS (vanilla HTML)
- **Video Player:** HLS.js with adaptive bitrate
- **Auth:** JWT with viewer/admin roles
- **Real-time:** WebSocket for channel change broadcasts
- **VPN:** Gluetun for stream routing (no longer needed with Dispatcharr)

### 2.2 Key Features to Migrate
1. **Single Channel Mode:** Admin selects channel, all viewers watch same stream
2. **Real-time Updates:** WebSocket broadcasts channel changes
3. **Quality Selection:** Adaptive bitrate with quality picker
4. **Chat:** Real-time viewer chat
5. **Responsive Design:** Desktop/Mobile/TV browser support

### 2.3 Features to Drop
- FFmpeg transcoding (Dispatcharr handles stream conversion)
- VPN routing (not needed - IPTV is US-based, Dispatcharr proxies)
- Complex HLS rewriting (Dispatcharr provides clean proxy URLs)

---

## 3. Recommended Technology Stack

### 3.1 Frontend Framework
**React 19 + TypeScript + Vite**
- Latest React with improved performance
- TypeScript for type safety
- Vite for fast development and builds

### 3.2 Video Player
**Option A: Vidstack (Recommended)**
- Modern, React 19 ready
- Excellent HLS support via hls.js
- 18+ React hooks for state management
- SSR-friendly, Next.js compatible
- Active development (2024-2025)
- Modular architecture, minimal bundle size

**Option B: Video.js**
- Battle-tested, 500k+ websites
- Extensive plugin ecosystem
- More complex setup

### 3.3 UI Framework
**shadcn/ui + Tailwind CSS v4**
- Beautifully designed, accessible components
- Copy-paste approach (you own the code)
- Tailwind v4 ready (OKLCH colors)
- AI-friendly development
- Trusted by OpenAI, Adobe, Sonos

### 3.4 State Management
**Zustand**
- Lightweight (<1KB gzipped)
- No boilerplate (no actions/reducers)
- Perfect for small-medium projects
- Works great with React hooks

### 3.5 Real-time
**Native WebSocket or Socket.io**
- Simple WebSocket for channel sync
- Optional: Socket.io for more features (reconnection, rooms)

### 3.6 Backend Options

**Option A: Minimal Backend (FastAPI - Recommended for MVP)**
```
React App <--> FastAPI (thin layer) <--> Dispatcharr API
                   |
                   └── Auth, Channel Selection, WebSocket
```
Responsibilities:
- User authentication (simple JWT)
- Current channel state storage
- WebSocket broadcast for channel changes
- Proxy to Dispatcharr API if CORS issues

**Option B: Direct Dispatcharr (Frontend-Only)**
```
React App <--> Dispatcharr API directly
```
Pros: Simplest architecture
Cons:
- CORS configuration needed on Dispatcharr
- No custom auth layer
- No channel sync between users

**Option C: Full Backend (Not Recommended)**
Overkill for MVP, replicates Dispatcharr functionality

---

## 4. MVP Feature Scope

### 4.1 Must Have (v1)
1. **Single Channel Viewer**
   - Full-screen video player
   - Quality selection (auto/manual)
   - Responsive layout (desktop/mobile/TV)

2. **Admin Channel Selection**
   - Protected admin route
   - Channel list from Dispatcharr
   - Select current channel
   - Real-time broadcast to viewers

3. **Basic Authentication**
   - Simple login (admin/viewer credentials)
   - JWT tokens
   - Protected routes

4. **10-Foot UI Design**
   - Large, readable text
   - D-pad/arrow key navigation
   - Focus indicators
   - Auto-hide controls

### 4.2 Nice to Have (v2)
- EPG/Program Guide display
- Multi-channel selection for viewers
- Chat functionality
- Recording scheduling
- User preferences persistence

### 4.3 Out of Scope
- FFmpeg transcoding (Dispatcharr handles it)
- VPN management
- M3U/EPG source management (done in Dispatcharr)
- DVR storage management

---

## 5. Architecture Design (FINALIZED)

### 5.1 Deployment Decision
- **App Location:** plex-stack VM (192.168.50.x network)
- **Dispatcharr Location:** VPS (10.8.0.2 via Wireguard)
- **Public Access:** Via Nginx Proxy Manager (SSL already configured)
- **Authentication:** Simple hardcoded credentials

### 5.2 Final Architecture (Option B - Minimal Exposure)
```
┌─────────────────────────────────────────────────────────────────┐
│                       PUBLIC INTERNET                           │
│                                                                 │
│  ┌────────────────────────┐    ┌──────────────────────────────┐│
│  │  iptv.domain.com       │    │  streams.domain.com          ││
│  │  (Frontend + API)      │    │  (Stream proxy endpoint only)││
│  └───────────┬────────────┘    └───────────────┬──────────────┘│
└──────────────┼─────────────────────────────────┼────────────────┘
               │                                 │
               ▼                                 ▼
┌──────────────────────────────┐    ┌─────────────────────────────┐
│  plex-stack (192.168.50.x)   │    │   VPS (10.8.0.2 via WG)     │
│  ┌────────────────────────┐  │    │  ┌───────────────────────┐  │
│  │     IPTV Viewer App    │  │    │  │    Dispatcharr        │  │
│  │  ┌──────┐  ┌────────┐  │  │    │  │    (:9191)            │  │
│  │  │React │  │FastAPI │──┼──┼─WG─┼──┤                       │  │
│  │  │  UI  │  │Backend │  │  │    │  │  • /hdhr/lineup.json  │  │
│  │  └──────┘  └────────┘  │  │    │  │  • /api/channels/     │  │
│  │       ┌────────┐       │  │    │  │  • Admin UI (internal)│  │
│  │       │WebSocket│      │  │    │  └───────────────────────┘  │
│  │       │ Server │       │  │    │             │               │
│  │       └────────┘       │  │    │             ▼               │
│  └────────────────────────┘  │    │  ┌───────────────────────┐  │
└──────────────────────────────┘    │  │  /proxy/ts/stream/*   │  │
                                    │  │  (PUBLIC via NPM)     │  │
                                    │  └───────────────────────┘  │
                                    └─────────────────────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Client Devices                           │
│   ┌──────────┐    ┌──────────┐    ┌────────────────────────┐   │
│   │ Desktop  │    │  Mobile  │    │     TV Browser         │   │
│   │ Browser  │    │  Browser │    │   (WebOS/Tizen)        │   │
│   └──────────┘    └──────────┘    └────────────────────────┘   │
│                                                                 │
│   Video streams fetched directly from streams.domain.com       │
│   API/auth/channel selection via iptv.domain.com               │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Public Endpoints (via Nginx Proxy Manager)

| Domain | Target | Purpose |
|--------|--------|---------|
| `iptv.domain.com` | plex-stack:8080 | React app + FastAPI backend |
| `streams.domain.com` | VPS:9191 (only `/proxy/ts/stream/*`) | Video stream proxy |

### 5.4 Internal Only (via Wireguard)

| Service | Access | Purpose |
|---------|--------|---------|
| Dispatcharr Admin UI | `10.8.0.2:9191` | Channel/EPG management |
| Dispatcharr API | `10.8.0.2:9191/api/*` | Backend fetches channels |
| HDHomeRun endpoints | `10.8.0.2:9191/hdhr/*` | Backend fetches lineup |

### 5.2 Data Flow
1. **Channel Selection (Admin):**
   ```
   Admin UI → FastAPI → Store in memory/SQLite → WebSocket broadcast
   ```

2. **Stream Playback (Viewer):**
   ```
   React App → Fetch current channel → Vidstack → Dispatcharr /proxy/ts/stream/{id}
   ```

3. **Channel Sync:**
   ```
   WebSocket → Receive channel_changed event → Update Vidstack source
   ```

---

## 6. Implementation Phases

### Phase 1: Project Setup
- Initialize React + Vite + TypeScript project
- Configure Tailwind CSS v4
- Install shadcn/ui components
- Set up Vidstack player
- Create basic routing (React Router)

### Phase 2: Core Video Player
- Implement Vidstack with HLS support
- Create responsive player layout
- Add quality selection controls
- Implement fullscreen toggle
- Test with Dispatcharr stream URLs

### Phase 3: Backend (Minimal)
- FastAPI project setup
- JWT authentication
- Channel state management endpoint
- WebSocket server for broadcasts
- CORS configuration

### Phase 4: Admin Interface
- Protected admin route
- Fetch channels from Dispatcharr
- Channel selection UI
- WebSocket broadcast on change

### Phase 5: Viewer Experience
- Connect to WebSocket
- Auto-update stream on channel change
- 10-foot UI optimizations
- Keyboard/remote navigation

### Phase 6: Deployment
- Docker containerization
- Nginx reverse proxy
- HTTPS configuration
- VPN/Wireguard access setup

---

## 7. Decisions Made (Previously Open Questions)

| Question | Decision |
|----------|----------|
| **Deployment Location** | plex-stack VM (192.168.50.x), separate from Dispatcharr |
| **Domain/SSL** | Already handled via Nginx Proxy Manager |
| **Authentication** | Simple hardcoded credentials (admin/viewer) |
| **EPG Priority** | Not for MVP - just live channel view |
| **Network Access** | Wireguard working (VPS at 10.8.0.2) |
| **Stream Exposure** | Option B - expose only `/proxy/ts/stream/*` publicly |
| **External Access** | Friends access via public internet, no VPN required |

---

## 8. Technology Recommendations Summary

| Component | Recommendation | Alternative |
|-----------|---------------|-------------|
| Framework | React 19 + TypeScript | - |
| Bundler | Vite | Next.js (if SSR needed) |
| Video Player | Vidstack | Video.js |
| UI Components | shadcn/ui | Radix UI |
| Styling | Tailwind CSS v4 | CSS Modules |
| State | Zustand | React Context |
| Backend | FastAPI | None (direct API) |
| Auth | JWT (simple) | Dispatcharr accounts |
| Real-time | WebSocket | Socket.io |
| Database | SQLite/JSON file | None (in-memory) |

---

## 9. Risk Assessment

### Low Risk
- Video playback (Vidstack + Dispatcharr proven)
- UI development (shadcn/ui is mature)
- Authentication (simple JWT is well-understood)

### Medium Risk
- CORS issues with direct Dispatcharr access
- WebSocket reconnection handling
- TV browser compatibility (test required)

### Mitigation Strategies
- Use FastAPI as proxy layer to avoid CORS
- Implement robust WebSocket reconnection
- Test early on target TV browsers

---

## 10. Next Steps

1. **User Approval:** Review this plan with Jon
2. **Clarify Questions:** Get answers to open questions (Section 7)
3. **Create Product Brief:** Formalize requirements
4. **Architecture Document:** Detail technical specifications
5. **Epic/Story Breakdown:** Create implementation stories
6. **Begin Development:** Phase 1 implementation

---

## Sources & References

### Video Players
- [Vidstack Player](https://vidstack.io/) - Modern React video player
- [Video.js](https://videojs.com/) - Battle-tested video player
- [hls.js](https://github.com/video-dev/hls.js) - HLS playback library

### UI Libraries
- [shadcn/ui](https://ui.shadcn.com/) - React component library
- [Tailwind CSS v4](https://tailwindcss.com/) - Utility-first CSS

### State Management
- [Zustand](https://zustand.docs.pmnd.rs/) - Lightweight state management
- [Zustand vs Redux Comparison](https://zustand.docs.pmnd.rs/getting-started/comparison)

### TV UI Design
- [10 Tips for UI/UX Design on Smart TV](https://noriginmedia.com/10-tips-for-ui-ux-design-on-smart-tv/)
- [Netflix TV UI Blog](http://techblog.netflix.com/2017/01/crafting-high-performance-tv-user.html)
- [React Native TV](https://reactnative.dev/docs/building-for-tv)

### Dispatcharr
- [Dispatcharr GitHub](https://github.com/Dispatcharr/Dispatcharr)
- [Dispatcharr Docs](https://dispatcharr.github.io/Dispatcharr-Docs/)

