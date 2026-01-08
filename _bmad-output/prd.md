---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
inputDocuments:
  - '_bmad-output/research/dispatcharr-iptv-viewer-research.md'
documentCounts:
  briefs: 0
  research: 1
  brainstorming: 0
  projectDocs: 0
workflowType: 'prd'
lastStep: 11
project_name: 'iptv_viewer2'
user_name: 'Jon'
date: '2025-12-23'
---

# Product Requirements Document - iptv_viewer2

**Author:** Jon
**Date:** 2025-12-23

## Executive Summary

A modern React-based IPTV viewer that provides a clean, synchronized viewing experience for you and friends. The application leverages Dispatcharr (deployed on VPS) for all stream proxying and EPG management, allowing the frontend to focus purely on user experience.

The core use case is simple: you (as admin) select a channel, and all connected viewers automatically switch to watch the same stream in real-time. No VPN required for viewers - streams are proxied through Dispatcharr and exposed via Nginx Proxy Manager.

### What Makes This Special

- **Watch Party Mode**: Real-time synchronized viewing where admin channel selection broadcasts to all viewers via WebSocket
- **10-Foot UI Design**: Built for TV browsers (WebOS/Tizen) with large text, D-pad navigation, and auto-hiding controls
- **Architectural Simplicity**: Dispatcharr handles stream complexity (proxying, failover, EPG); this app handles pure UX

## Project Classification

**Technical Type:** web_app (SPA with real-time features)
**Domain:** general (Media/Entertainment)
**Complexity:** low
**Project Context:** Greenfield - new React-based replacement for existing Alpine.js viewer

## Success Criteria

### User Success
- Stream plays reliably on desktop, mobile, and TV browsers without buffering issues
- Friends can access and view streams without needing VPN or technical setup
- Channel changes sync instantly across all connected viewers

### Technical Success
- Video playback works via Vidstack + HLS on target devices (Chrome, Safari, WebOS, Tizen)
- WebSocket maintains connection for real-time channel sync
- App deploys cleanly to plex-stack VM via Docker

### Measurable Outcomes
- Stream loads within 3 seconds of channel selection
- WebSocket reconnects automatically if connection drops
- Works on at least: Chrome desktop, Safari iOS, LG WebOS TV browser

## Product Scope

### MVP - Minimum Viable Product
1. Full-screen video player with quality selection
2. Admin-protected channel selection from Dispatcharr lineup
3. Real-time WebSocket broadcast of channel changes
4. Simple JWT auth (hardcoded admin/viewer credentials)
5. Responsive layout for desktop/mobile/TV

### Growth Features (Post-MVP)
- EPG/Program Guide display ✓ (Epic 6-7)
- Multi-channel selection for viewers
- Chat functionality ✓ (Epic 13)
- User preferences persistence
- Highlight capture and replay ✓ (Epic 12)

### Vision (Future)
- Recording/DVR scheduling
- Multiple concurrent watch parties
- Mobile app wrapper

## User Journeys

### Journey 1: Jon - Hosting Game Night

Jon wants to watch the hockey game with a few friends who are scattered across different cities. He opens iptv.domain.com on his phone, logs in with his admin credentials, and sees the channel list pulled from Dispatcharr. He scrolls to "Sportsnet West" and taps to select it.

Instantly, his TV (already showing the viewer interface) switches to the hockey stream. He texts his friends the link - they click, see the viewer login, and within seconds they're all watching the same feed. When the game ends, Jon switches to TSN for post-game coverage and everyone's screen updates automatically.

**Requirements revealed:** Admin auth, channel list from Dispatcharr API, channel selection, WebSocket broadcast, instant stream switching

### Journey 2: Dave - Joining from the Couch

Dave gets a text from Jon with a link to watch the game. He opens it on his LG TV's browser, hits the bookmark he saved last time, and the familiar full-screen player loads. The game is already playing - no channel picking, no setup. He grabs a beer and settles in.

Halfway through, the stream hiccups for a second but recovers on its own. When Jon switches to a different channel at halftime, Dave's TV seamlessly transitions without him touching anything.

**Requirements revealed:** Viewer auth (simple), auto-play current channel, responsive TV UI, stream resilience, WebSocket auto-reconnect, seamless channel transitions

### Journey 3: Jon - Troubleshooting a Dead Stream

Jon selects a channel but it won't load. He checks Dispatcharr directly (via VPN to the admin UI) and sees the upstream source is down. He picks an alternate channel that's working and broadcasts that instead. His friends never knew there was an issue.

**Requirements revealed:** Error handling for failed streams, admin has visibility into what's playing, quick channel switching for recovery

### Journey Requirements Summary

| Capability | Admin Journey | Viewer Journey | Error Journey |
|------------|--------------|----------------|---------------|
| Auth (JWT) | ✓ | ✓ | ✓ |
| Channel List | ✓ | | |
| Channel Selection | ✓ | | ✓ |
| WebSocket Sync | ✓ | ✓ | |
| Video Player | ✓ | ✓ | |
| 10-Foot UI | | ✓ | |
| Error Recovery | | | ✓ |

## Web Application Requirements

### Browser & Platform Support

| Platform | Browser | Priority | Notes |
|----------|---------|----------|-------|
| Desktop | Chrome, Firefox, Safari | High | Primary admin interface |
| iOS | Safari | High | Mobile viewer access |
| Android | Chrome | Medium | Mobile viewer access |
| LG TV | WebOS Browser | High | Primary viewing device |
| Samsung TV | Tizen Browser | Medium | Secondary TV support |

### Responsive Design

- **Desktop (>1024px):** Full admin controls, channel list sidebar
- **Tablet (768-1024px):** Simplified admin, collapsible channel list
- **Mobile (<768px):** Viewer-focused, minimal controls
- **TV (10-foot UI):** Large text (24px+), focus indicators, D-pad navigation, auto-hide controls

### Performance Targets

- Initial load: <3 seconds on 4G connection
- Stream start: <3 seconds after channel selection
- WebSocket reconnect: <2 seconds after disconnect
- Bundle size: <500KB gzipped (excluding video player)

### Real-Time Architecture

- WebSocket connection for channel state sync
- Automatic reconnection with exponential backoff
- Heartbeat to detect stale connections
- Single source of truth: backend holds current channel state

### SEO & Accessibility

- **SEO:** Not required (private, auth-gated application)
- **Accessibility:** Focus on TV remote/keyboard navigation; WCAG AA for basic controls

## Project Scoping & Phased Development

### MVP Strategy

**Approach:** Problem-Solving MVP
**Team:** Solo developer (you)
**Core Insight:** Dispatcharr handles stream complexity; this app is pure UX layer

### MVP Feature Set (Phase 1)

**Core Journeys Supported:**
- Admin selects channel → all viewers sync
- Viewer joins and watches current stream

**Must-Have Capabilities:**
1. Vidstack video player with HLS support
2. Admin auth + channel list from Dispatcharr `/hdhr/lineup.json`
3. Channel selection broadcasts via WebSocket
4. Viewer auto-plays current channel on connect
5. Responsive layout (desktop/mobile/TV)

**Explicitly NOT in MVP:**
- EPG/program guide
- Chat
- Recording/DVR
- User accounts (just hardcoded credentials)

### Post-MVP Roadmap

**Phase 2 - Enhanced Viewing:**
- EPG overlay showing current/next program
- Quality indicator and manual quality selection
- Improved error handling and stream status

**Phase 3 - Social Features:**
- Simple chat
- Multiple watch party rooms
- User preferences persistence

### Risk Mitigation

**Technical Risk:** TV browser compatibility → Test early on LG WebOS
**Resource Risk:** Solo dev → Keep scope minimal, ship fast, iterate

## Functional Requirements

### Authentication & Authorization

- FR1: Users can authenticate with username/password credentials
- FR2: System can distinguish between admin and viewer roles
- FR3: Admin can access channel management features
- FR4: Viewers can access the video player interface
- FR5: System can maintain authentication state across sessions (JWT)

### Channel Management (Admin)

- FR6: Admin can view list of available channels from Dispatcharr
- FR7: Admin can select a channel to broadcast to all viewers
- FR8: Admin can see the currently selected channel
- FR9: Admin can change the channel at any time
- FR10: System can fetch channel lineup from Dispatcharr API

### Video Playback

- FR11: Viewers can watch the currently selected video stream
- FR12: Viewers can see video in full-screen mode
- FR13: Viewers can control video volume
- FR14: System can play HLS streams via Dispatcharr proxy
- FR15: System can recover from temporary stream interruptions

### Real-Time Synchronization

- FR16: System can broadcast channel changes to all connected viewers
- FR17: Viewers can receive channel updates in real-time
- FR18: Viewer's video player can automatically switch to new channel
- FR19: System can detect and recover from WebSocket disconnections
- FR20: New viewers can receive current channel state on connect

### User Interface

- FR21: Interface can adapt to desktop screen sizes
- FR22: Interface can adapt to mobile screen sizes
- FR23: Interface can adapt to TV screen sizes (10-foot UI)
- FR24: Users can navigate using keyboard/remote controls
- FR25: Video controls can auto-hide during playback
- FR26: Users can see loading/buffering state indicators

## Non-Functional Requirements

### Performance

- NFR1: Stream playback begins within 3 seconds of channel selection
- NFR2: Channel switch completes within 2 seconds for all viewers
- NFR3: WebSocket messages deliver within 500ms
- NFR4: UI remains responsive during stream loading (no freezing)
- NFR5: Initial page load under 3 seconds on 4G connection

### Reliability

- NFR6: WebSocket auto-reconnects within 5 seconds of connection loss
- NFR7: Video player recovers from temporary stream interruptions without user action
- NFR8: App remains functional if Dispatcharr API is temporarily unavailable (graceful degradation)

### Integration

- NFR9: Compatible with Dispatcharr API v0.15+ endpoints
- NFR10: Supports HLS streams from Dispatcharr proxy
- NFR11: Handles Dispatcharr channel UUID format

### Usability (10-Foot UI)

- NFR12: All interactive elements have minimum 44px touch/focus targets
- NFR13: Text readable from 10 feet (minimum 24px for body text)
- NFR14: High contrast between text and background
- NFR15: Full keyboard/D-pad navigation without mouse required

### Chat Functionality (FR63-66)

- FR63: Users can optionally send and receive chat messages while watching
- FR64: Chat messages are broadcast to all connected users in real-time
- FR65: Users can toggle chat visibility without interrupting video playback
- FR66: Chat feature can be enabled/disabled via environment configuration

### Highlight Modal (FR67-69)

- FR67: Users can preview captured highlights in a modal before downloading
- FR68: Users can scrub (seek forward/backward) through highlight previews
- FR69: Users can download highlights in MP4 or WebM format

### UI Polish (FR70-72)

- FR70: All tooltips display with theme-consistent styling (light/dark mode)
- FR71: Application displays a custom favicon in browser tabs
- FR72: Video control bar maintains consistent position across playback modes

### Admin Panel Improvements (FR73-74)

- FR73: Admin can view channels organized in collapsible groups
- FR74: Admin panel displays correctly on mobile and TV devices without overlap

---

## Post-Implementation Updates

### 2025-12-26: Stream Format Clarification

**Original Assumption (FR14):** "System can play HLS streams via Dispatcharr proxy"

**Actual Implementation:** Dispatcharr provides raw MPEG-TS streams, not HLS.

**Technical Details:**
- Stream URL format: `https://streams.domain.com/proxy/ts/stream/{uuid}`
- Stream type: Raw MPEG Transport Stream (MPEG-TS)
- Player: mpegts.js v1.8.0 (JavaScript MPEG-TS decoder)
- Vidstack was replaced with mpegts.js as browsers cannot natively decode raw MPEG-TS

**Updated FR14:** System can play MPEG-TS streams via Dispatcharr proxy using mpegts.js decoder

