# Sprint Change Proposal: Epic 8 - Optional Plex Authentication

**Date:** 2026-01-04
**Requested by:** Jon
**Status:** Approved

---

## 1. Issue Summary

### Problem Statement
Currently, authentication in iptv_viewer2 is limited to hardcoded credentials stored in environment variables. This requires sharing credentials with friends who want to access the app, which is cumbersome and less secure than leveraging existing identity providers.

### Context
- Jon has previously implemented Plex authentication in the clipforge project
- Overseerr provides a proven reference implementation for Plex OAuth flow
- Many users of iptv_viewer2 are likely already Plex users with server access

### Evidence & Rationale
- Plex auth eliminates credential sharing with friends
- Feature-flagged approach allows gradual rollout
- Reference implementations confirm technical feasibility
- Both auth methods can coexist for flexibility

---

## 2. Impact Analysis

### Epic Impact
| Epic | Impact | Details |
|------|--------|---------|
| Epic 1 | Minor modification | Add `LOCAL_AUTH_ENABLED` feature flag to existing auth |
| Epic 8 | **New epic** | Complete Plex authentication implementation |
| Epics 2-7 | None | No changes required |

### Story Impact
| Story | Status | Change |
|-------|--------|--------|
| 8.1 | New | Plex Authentication Backend Service |
| 8.2 | New | Plex OAuth Token Acquisition |
| 8.3 | New | Plex User Role Assignment |
| 8.4 | New | Conditional Login UI |
| 8.5 | New | Feature-Flagged Local Authentication |

### Artifact Changes Required

#### epics.md
- Add complete Epic 8 with 5 stories

#### product-brief (PRD)
- Update "Out of Scope" table to reference Epic 8
- Add Epic 8 to v2 Enhancements section

#### sprint-status.yaml
- Add Epic 8 tracking entries

#### .env.example
- Add `LOCAL_AUTH_ENABLED` (default: false)
- Add `PLEX_AUTH_ENABLED` (default: false)
- Add `PLEX_SERVER_TOKEN`
- Add `PLEX_SERVER_MACHINE_ID`
- Add `PLEX_DEFAULT_ROLE`

### Technical Impact
- New Plex API integration service in backend
- New OAuth popup flow in frontend
- Conditional rendering on login page
- Backend startup validation for auth configuration

---

## 3. Recommended Approach

### Selected Path: Direct Adjustment

Add new Epic 8 within existing plan structure. No rollback or MVP scope changes required.

### Rationale
- **Non-breaking**: Feature-flagged, existing auth unaffected when disabled
- **Independent**: Can be developed without blocking other epics
- **Low risk**: Proven pattern from Overseerr reference
- **Flexible**: Both auth methods can coexist

### Effort Estimate
- **Backend**: Medium (Plex API service, endpoint modifications)
- **Frontend**: Low (conditional UI, OAuth popup integration)
- **Testing**: Medium (two auth flows, feature flag combinations)

### Risk Assessment
- **Risk Level**: Low
- **Mitigation**: Feature flags allow instant rollback by configuration change

---

## 4. Detailed Change Proposals

### 4.1 Epic 8 Addition (epics.md)

```markdown
## Epic 8: Optional Plex Authentication

Users can optionally authenticate using their Plex account if they have access to the host's Plex Media Server. This provides a seamless login experience for friends who are already Plex users.

**Key Features:**
- Environment variable feature flag (`PLEX_AUTH_ENABLED`)
- Plex OAuth popup flow for token acquisition
- Backend validation against Plex Media Server
- Automatic role assignment based on configuration
- Coexists with existing credential-based auth

**Environment Variables:**
- `PLEX_AUTH_ENABLED` - Enable/disable Plex auth (default: false)
- `PLEX_SERVER_TOKEN` - Admin's Plex server token for user validation
- `PLEX_SERVER_MACHINE_ID` - Plex server machine identifier
- `PLEX_DEFAULT_ROLE` - Default role for Plex users (viewer/admin)

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

### Story 8.4: Conditional Login UI

As a user,
I want the login page to show appropriate options based on configuration,
So that I see only relevant authentication methods.

**Acceptance Criteria:**

**Given** `PLEX_AUTH_ENABLED=false` or not set
**When** the login page renders
**Then** I see only the username/password form
**And** no Plex sign-in option is visible

**Given** `PLEX_AUTH_ENABLED=true`
**When** the login page renders
**Then** I see both the credential form and "Sign in with Plex" button
**And** a visual separator ("or") between the options

**Given** both auth methods are available
**When** I choose either method
**Then** successful auth leads to the same main app experience

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
**And** optionally fail startup (configurable)

**Given** `LOCAL_AUTH_ENABLED=false` and `PLEX_AUTH_ENABLED=true`
**When** the login page renders
**Then** only "Sign in with Plex" button is shown
**And** no credential form is visible
```

### 4.2 PRD Update (product-brief)

**Out of Scope table update:**
```markdown
| User registration | Hardcoded credentials sufficient; Plex auth added in Epic 8 | v2 (Epic 8) |
```

**Future Vision addition:**
```markdown
#### v2 Enhancements (Epic 8 - Planned)
- **Optional Plex Authentication** - Feature-flagged Plex OAuth for server members
- Eliminates need to share credentials with friends
- Automatic role assignment based on Plex server access
```

### 4.3 Sprint Status Update (sprint-status.yaml)

```yaml
  # Epic 8: Optional Plex Authentication
  epic-8: backlog
  8-1-plex-authentication-backend-service: backlog
  8-2-plex-oauth-token-acquisition: backlog
  8-3-plex-user-role-assignment: backlog
  8-4-conditional-login-ui: backlog
  8-5-feature-flagged-local-authentication: backlog
  epic-8-retrospective: optional
```

### 4.4 Environment Configuration (.env.example)

```bash
# ===================
# Authentication Configuration
# ===================
# At least one auth method must be enabled

# Local Auth (username/password) - disabled by default
# LOCAL_AUTH_ENABLED=false
# ADMIN_USERNAME=admin
# ADMIN_PASSWORD=changeme
# VIEWER_USERNAME=viewer
# VIEWER_PASSWORD=changeme

# Plex Authentication - disabled by default
# PLEX_AUTH_ENABLED=false
# PLEX_SERVER_TOKEN=your-plex-server-token
# PLEX_SERVER_MACHINE_ID=your-server-machine-id
# PLEX_DEFAULT_ROLE=viewer
```

---

## 5. Implementation Handoff

### Change Scope Classification: Minor

This change can be implemented directly by the development team without requiring backlog reorganization or architectural review.

### Handoff Recipients

| Role | Responsibility |
|------|----------------|
| Developer | Implement Epic 8 stories |
| Developer | Add feature flag to existing auth (Story 8.5) |

### Implementation Sequence

1. **Story 8.5** - Add `LOCAL_AUTH_ENABLED` flag to existing auth (prerequisite)
2. **Story 8.1** - Plex backend service
3. **Story 8.2** - OAuth popup flow
4. **Story 8.3** - Role assignment logic
5. **Story 8.4** - Conditional login UI

### Success Criteria

- [ ] Both auth methods work independently when enabled
- [ ] Both auth methods work together when both enabled
- [ ] App shows appropriate error when neither enabled
- [ ] Plex users with server access can authenticate
- [ ] Plex users without server access are rejected
- [ ] Feature flags can be toggled without code changes

---

## Approval

**Proposal Status:** Approved
**Approved by:** Jon
**Approval Date:** 2026-01-04

---

## Next Steps

1. Apply changes to `epics.md`
2. Apply changes to `product-brief-iptv_viewer2-2025-12-23.md`
3. Apply changes to `sprint-status.yaml`
4. Update `.env.example` when implementing
5. Create story files via `create-story` workflow when ready to develop
