# TV (IPTV Viewer) Project

## Obsidian Progress Tracking

**Vault Path:** `/home/jon/Jon's Vault/Projects/tv/`
**Index File:** `tv.md`

### When to Update Obsidian

Update the project notes when meaningful progress occurs:

1. **New Story/Feature Started**
   - Add entry under `## Current Work` with story ID and brief description

2. **Story/Feature Completed**
   - Move from Current Work to `## Completed` with date
   - One-line summary of what was delivered

3. **Blocked/Waiting**
   - Note blocker under `## Blockers` with date and reason

4. **Key Decisions**
   - Add to `## Decisions` when architectural or significant technical choices are made

5. **Bugs Fixed**
   - Only notable bugs worth remembering, add to `## Bug Fixes`

### Update Format

Keep entries minimal and scannable:

```markdown
## Current Work
- [2026-02-01] Story 4-2: Add PiP mode for mobile

## Completed
- [2026-02-01] Story 4-1: NHL scores overlay - live game updates with auto-refresh

## Decisions
- [2026-02-01] Using Vidstack over Video.js for better HLS support

## Blockers
- [2026-02-01] Waiting on Dispatcharr API for new endpoint

## Bug Fixes
- [2026-02-01] Fixed fullscreen filter menu portal container
```

### What NOT to Update

- Minor refactors or code cleanup
- Test additions (unless significant coverage milestone)
- Dependency updates
- WIP commits

### How to Update

```bash
# Append to the Notes section or create new sections as needed
# File: /home/jon/Jon's Vault/Projects/tv/tv.md
```

Use the Edit tool to append entries. Keep the index file clean - create separate files for detailed logs if needed (e.g., `tv-log-2026-02.md`).
