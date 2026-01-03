---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - _bmad-output/research/dispatcharr-iptv-viewer-research.md
workflowType: 'product-brief'
status: 'complete'
lastStep: 6
project_name: 'iptv_viewer2'
user_name: 'Jon'
date: '2025-12-23'
completedAt: '2025-12-23'
---

# Product Brief: iptv_viewer2

## Executive Summary

iptv_viewer2 is a modern React-based IPTV viewing application designed for synchronized group watching experiences. It leverages Dispatcharr (deployed on VPS) for stream proxying and EPG management, eliminating the need for VPN routing or transcoding complexity on the client side.

The application enables an admin to select a channel that all viewers watch simultaneously, with real-time synchronization via WebSocket. Designed with a 10-foot UI philosophy, it works seamlessly on desktop, mobile, and TV browsers (WebOS/Tizen).

---

## Core Vision

### Problem Statement

The existing IPTV viewer solution requires a complex stack including VPN routing (Gluetun), FFmpeg transcoding, and HLS stream rewriting. This complexity is now unnecessary since Dispatcharr handles stream proxying, failover, and EPG management. The current vanilla HTML/Alpine.js frontend also feels dated compared to modern React applications.

### Problem Impact

- **Maintenance burden**: Multiple moving parts (VPN, FFmpeg, HLS rewriting) require ongoing maintenance
- **User experience**: Alpine.js interface lacks the polish and responsiveness of modern React apps
- **Deployment complexity**: VPN and transcoding requirements complicate deployment and troubleshooting
- **Resource overhead**: Unnecessary processing when Dispatcharr already provides clean proxy streams

### Why Existing Solutions Fall Short

| Solution | Limitation |
|----------|------------|
| Existing iptv_viewer | Over-engineered for current needs; VPN/FFmpeg overhead |
| Generic IPTV players | No synchronized viewing; no admin channel control |
| Plex/Jellyfin | Complex setup; designed for DVR, not live viewing parties |
| Web-based M3U players | No channel sync; no 10-foot UI; no group experience |

### Proposed Solution

A lightweight, modern IPTV viewer built with:
- **React 19 + TypeScript + Vite** for a fast, type-safe frontend
- **Vidstack** for robust HLS video playback with excellent React integration
- **shadcn/ui + Tailwind CSS v4** for beautiful, accessible UI components
- **Minimal FastAPI backend** for auth, channel state, and WebSocket broadcast
- **Zustand** for lightweight state management

Architecture: React app on plex-stack VM connects to Dispatcharr on VPS via Wireguard. Viewers access streams directly from `streams.domain.com` (Dispatcharr proxy endpoint exposed via Nginx Proxy Manager).

### Key Differentiators

1. **Synchronized Viewing**: Admin selects channel → WebSocket broadcasts → all viewers switch instantly
2. **Zero VPN for Viewers**: Dispatcharr proxy handles all stream complexity; viewers just need internet
3. **10-Foot UI First**: Large text, D-pad navigation, auto-hide controls - designed for TV browsers
4. **Minimal Stack**: No FFmpeg, no VPN routing, no complex stream management
5. **Leverages Existing Infrastructure**: Dispatcharr (VPS), Nginx Proxy Manager (SSL), Wireguard (internal comms)

---

## Target Users

### Primary Users

#### The Host (Admin)
**Persona: Jon**
- **Role**: Stream host who manages viewing parties for friends
- **Context**: Tech-savvy home server enthusiast with plex-stack infrastructure
- **Goals**:
  - Easily select and switch channels for group viewing
  - Minimal friction between "I want to watch X" and everyone seeing X
  - Reliable streams without babysitting VPNs or transcoding
- **Pain Points with Current Solution**:
  - Complex stack requires monitoring multiple services
  - VPN issues can disrupt viewing for everyone
  - Alpine.js UI feels clunky for channel management
- **Success Moment**: Switching to a game with one click and knowing everyone's stream updated instantly

#### The Viewer (Friend)
**Persona: Alex**
- **Role**: Remote friend joining viewing parties
- **Context**: Non-technical user who just wants to watch sports/events with friends
- **Device**: Could be on laptop, phone, or smart TV (LG WebOS, Samsung Tizen)
- **Goals**:
  - Open a link and immediately start watching
  - No VPN installation or configuration
  - Works on their TV without sideloading apps
- **Pain Points**:
  - Previous solutions required VPN setup
  - Mobile/TV browser compatibility issues
  - Confusing interfaces that aren't remote-friendly
- **Success Moment**: Opening the URL on their TV, seeing the game, and never thinking about the tech

### Secondary Users

N/A - This is a focused personal project with two clear roles (host/viewer). No additional stakeholders, support roles, or enterprise considerations apply.

### User Journey

#### Host Journey
1. **Discovery**: Already owns the infrastructure; building for personal use
2. **Onboarding**: Deploy via Docker, configure Dispatcharr connection
3. **Core Usage**:
   - Log in as admin → See channel list from Dispatcharr
   - Click channel → All viewers instantly switch
   - Monitor active viewers (optional future feature)
4. **Success Moment**: First successful viewing party with friends watching simultaneously
5. **Long-term**: Becomes the default way to share live sports/events

#### Viewer Journey
1. **Discovery**: Receives link from Jon (host)
2. **Onboarding**:
   - Click link → Enter simple credentials → Start watching
   - Zero app installation, zero VPN, zero configuration
3. **Core Usage**:
   - Open bookmark/saved URL → Auto-connect to current channel
   - Stream switches automatically when host changes channel
   - Use TV remote/keyboard for basic controls (volume, fullscreen)
4. **Success Moment**: "This just works on my TV!"
5. **Long-term**: Bookmark becomes go-to for group viewing events

---

## Success Metrics

### Streaming Quality Parity (Critical - Non-Negotiable)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Visual quality | Identical to Dispatcharr direct playback | Side-by-side comparison |
| Stream sharpness | No additional compression artifacts | Visual inspection on 1080p+ displays |
| Playback smoothness | No stuttering, frame drops, or judder | 60fps content plays at 60fps |
| Startup latency | ≤ Dispatcharr direct stream startup | Time from click to first frame |
| Buffering events | Zero additional buffering vs direct | No buffering that Dispatcharr wouldn't have |

**Technical Requirements to Achieve Parity:**
- Vidstack/hls.js configured for quality-first (not bandwidth-first)
- No unnecessary transcoding or re-encoding in the chain
- Proper HLS segment handling without quality degradation
- Hardware acceleration utilized where available
- Correct aspect ratio and resolution preservation

### User Success Metrics

#### Host (Jon) Success Indicators
| Metric | Target | Measurement |
|--------|--------|-------------|
| Stream reliability | 99%+ uptime during viewing parties | No manual intervention needed during events |
| Channel switch latency | <3 seconds from click to all viewers updated | WebSocket broadcast timing |
| Setup time | <5 minutes to change channel lineup | Admin UI workflow timing |
| Support burden | Zero "how do I connect" questions from friends | Anecdotal tracking |

#### Viewer (Alex) Success Indicators
| Metric | Target | Measurement |
|--------|--------|-------------|
| First-try success | Stream plays on first URL visit | No refresh/retry needed |
| TV browser compatibility | Works on WebOS + Tizen | Tested on actual devices |
| Auto-sync reliability | 100% of channel changes received | No manual refresh needed |
| Playback quality | Adaptive bitrate working | Quality adjusts without buffering |

### Business Objectives

*Note: This is a personal project, so "business" objectives focus on practical value and time savings.*

| Objective | Success Criteria |
|-----------|------------------|
| Replace legacy viewer | Old iptv_viewer deprecated and removed |
| Reduce complexity | Eliminate VPN/FFmpeg/HLS-rewriting stack |
| Improve reliability | Fewer "it's not working" moments during events |
| Enable growth | Easy to add new friends without VPN setup |

### Key Performance Indicators

#### MVP Launch KPIs
- [ ] Stream plays successfully on desktop Chrome
- [ ] Stream plays successfully on LG WebOS TV browser
- [ ] Stream plays successfully on Samsung Tizen TV browser
- [ ] Stream quality matches Dispatcharr direct playback
- [ ] Admin can switch channels and all viewers update
- [ ] Simple auth prevents unauthorized access

#### Operational KPIs (Post-Launch)
| KPI | Target |
|-----|--------|
| Viewing party success rate | 100% of planned events work without issues |
| Mean time to recovery | <2 minutes if stream fails |
| Viewer capacity | 5+ simultaneous viewers stable |
| Maintenance time | <1 hour/month |

#### Quality of Life Metrics
- Friends stop asking "is the VPN working?"
- Jon stops babysitting streams during events
- New friends can join in <2 minutes

---

## MVP Scope

### Core Features

#### 1. Video Player (Viewer Experience)
- Full-screen Vidstack player with HLS support
- Stream quality matching Dispatcharr direct playback (non-negotiable)
- Responsive layout: desktop, mobile, TV browsers
- Auto-hide controls with TV-friendly focus indicators
- Keyboard/D-pad navigation for 10-foot UI

#### 2. Admin Channel Control
- Protected admin route (simple auth)
- Channel list fetched from Dispatcharr `/hdhr/lineup.json`
- One-click channel selection
- WebSocket broadcast to all connected viewers

#### 3. Real-Time Synchronization
- WebSocket connection for channel change events
- Automatic stream switch when admin changes channel
- Reconnection handling for dropped connections

#### 4. Authentication
- Simple hardcoded credentials (admin/viewer)
- JWT tokens for session management
- Protected routes (admin vs viewer)

#### 5. Deployment Ready
- Docker containerization
- Nginx reverse proxy compatible
- HTTPS via existing Nginx Proxy Manager

### Out of Scope for MVP

| Feature | Rationale | Target Version |
|---------|-----------|----------------|
| ~~EPG/Program Guide~~ | ~~Dispatcharr has this; focus on viewing first~~ | **Moved to Epic 6** |
| Multi-channel viewer selection | Contradicts "admin controls channel" model | v2 (optional) |
| Chat functionality | Nice-to-have, not core to viewing | v2 |
| Recording/DVR | Dispatcharr + Plex handle this | Never (out of scope) |
| User preferences | No persistent user state needed for MVP | v2 |
| FFmpeg transcoding | Dispatcharr handles stream conversion | Never |
| VPN management | Not needed with Dispatcharr proxy | Never |
| M3U/EPG source management | Done in Dispatcharr admin | Never |
| User registration | Hardcoded credentials sufficient | Maybe v2 |

### MVP Success Criteria

| Criteria | Validation |
|----------|------------|
| Stream quality parity | Side-by-side with Dispatcharr shows identical quality |
| TV browser works | Tested on actual LG WebOS and Samsung Tizen |
| Channel sync works | Admin switches, all viewers update within 3 seconds |
| Zero VPN questions | Friends connect without asking about VPN |
| First viewing party | Successful event with 3+ simultaneous viewers |

### Future Vision

#### v2 Enhancements (Epic 6 - In Progress)
- ~~EPG overlay showing current/next program~~ → **Now Playing in header** (Epic 6)
- **Viewer channel list removed** - viewers see video only (Epic 6)
- **Admin hamburger menu** - collapsible channel list on all breakpoints (Epic 6)
- **Slimmer header** with branding update "Jon's place" (Epic 6)
- Optional viewer channel browsing (admin can enable/disable) - deferred
- Simple chat sidebar for viewing parties
- Viewer count display for admin

#### v3+ Possibilities
- Mobile app wrapper (if TV browser proves insufficient)
- Multiple concurrent viewing rooms
- Integration with Discord for event coordination
- Stream recording triggers (via Dispatcharr API)

#### Explicitly Not Planned
- Replacing Dispatcharr functionality
- Complex user management
- Payment/subscription features
- Public access (always invite-only)

