# Story 12.6: Channel Card EPG Display

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an admin,
I want to see what's currently playing on each channel in the admin modal,
So that I can make informed channel selection choices.

## Acceptance Criteria

1. **Given** I open the admin modal "Channels" tab, **when** the channel list renders, **then** each channel card shows: logo, number, name, current programme title, progress bar

2. **Given** a channel has EPG data, **when** its card renders, **then** the current programme title is displayed **and** a mini progress bar shows how far into the programme

3. **Given** a channel has no EPG data, **when** its card renders, **then** "No programme info" is displayed in place of the title **and** no progress bar is shown

4. **Given** I open the admin modal, **when** EPG data is fetched, **then** current programmes for all visible channels are loaded

5. **Given** a programme ends while the modal is open, **when** the next programme starts, **then** the card updates to show the new programme

## Tasks / Subtasks

- [x] Task 1: Extend ChannelItem Props for EPG Data (AC: #1, #2, #3)
  - [x] Add `currentProgramme` prop (title string or null)
  - [x] Add `programmeStart` and `programmeEnd` props for progress calculation
  - [x] Add optional `logoUrl` prop for channel logo display

- [x] Task 2: Fetch EPG Data for All Channels (AC: #4)
  - [x] Add `useEffect` in ChannelList to fetch EPG data for all channels
  - [x] Use `fetchNowPlaying(channel.guideId)` for live channels
  - [x] Store results in local state: `Record<string, {title: string, start: string, end: string}>`
  - [x] Handle errors gracefully (silent fail per channel)

- [x] Task 3: Add Auto-Refresh for EPG Data (AC: #5)
  - [x] Add 5-minute interval refresh (matching existing pattern in TVChannelSidebar)
  - [x] Add 1-minute interval for progress bar updates (current time)
  - [x] Clean up intervals on unmount

- [x] Task 4: Update ChannelItem UI Layout (AC: #1, #2, #3)
  - [x] Restructure to show channel name on first line
  - [x] Add programme title on second line (or "No programme info" fallback)
  - [x] Add mini progress bar below programme title
  - [x] Calculate progress percentage: `(now - start) / (end - start) * 100`

- [x] Task 5: Style Channel Cards (AC: #1, #2)
  - [x] Use `min-w-0 flex-1` pattern for text truncation
  - [x] Add `truncate` class for long programme titles
  - [x] Style progress bar: `h-1 bg-muted rounded-full` with `bg-primary` fill
  - [x] Keep existing 10-foot UI compliance (56px min height)

- [x] Task 6: Update Tests (AC: #1-5)
  - [x] Update ChannelList.test.tsx for new props and EPG display
  - [x] Mock `fetchNowPlaying` for tests
  - [x] Add tests for progress bar calculation
  - [x] Test fallback display when no EPG data

## Dev Notes

### Current ChannelItem Implementation

The existing `ChannelItem` component (`frontend/src/components/ChannelList.tsx` lines 173-215) displays:
- Channel name (text only)
- "Now Playing" indicator when selected
- No EPG data currently

```tsx
<div className={cn('flex items-center gap-3 rounded-lg border p-4 ...')}>
  <span className="font-medium">{channel.name}</span>
  {isSelected && (
    <span className="ml-auto text-sm text-primary">Now Playing</span>
  )}
</div>
```

### Target ChannelItem Layout

```tsx
<div className={cn('flex items-center gap-3 rounded-lg border p-4 ...')}>
  <div className="min-w-0 flex-1">
    <div className="flex items-baseline gap-2">
      <span className="font-medium truncate">{channel.name}</span>
      {isSelected && (
        <span className="text-sm text-primary">Now Playing</span>
      )}
    </div>
    <p className="truncate text-sm text-muted-foreground">
      {currentProgramme || 'No programme info'}
    </p>
    {progressPercent !== null && (
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden mt-1.5">
        <div
          className="h-full bg-primary transition-all duration-1000"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    )}
  </div>
</div>
```

### EPG Data Fetching Pattern

Follow the existing pattern from TVChannelSidebar (lines 22-52):

```tsx
// State for EPG data
const [channelEPG, setChannelEPG] = useState<Record<string, {
  title: string
  start: string
  end: string
}>>({})
const [currentTime, setCurrentTime] = useState(Date.now())

// Fetch EPG for all channels
useEffect(() => {
  const fetchAllEPG = async () => {
    const results: Record<string, {title: string, start: string, end: string}> = {}
    await Promise.all(
      channels.map(async (channel) => {
        try {
          const data = await fetchNowPlaying(channel.guideId)
          if (data.currentProgram) {
            results[channel.id] = {
              title: data.currentProgram.title,
              start: data.currentProgram.startTime,
              end: data.currentProgram.endTime,
            }
          }
        } catch {
          // Silent fail - EPG data is non-critical
        }
      })
    )
    setChannelEPG(results)
  }

  if (channels.length > 0) {
    fetchAllEPG()
    const interval = setInterval(fetchAllEPG, 5 * 60 * 1000) // 5 minutes
    return () => clearInterval(interval)
  }
}, [channels])

// Update current time every minute for progress bars
useEffect(() => {
  const interval = setInterval(() => setCurrentTime(Date.now()), 60 * 1000)
  return () => clearInterval(interval)
}, [])
```

### Progress Bar Calculation

```tsx
function calculateProgress(start: string, end: string): number | null {
  const now = Date.now()
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()

  if (now < startTime || now > endTime) return null

  const elapsed = now - startTime
  const duration = endTime - startTime

  return Math.min(100, Math.max(0, (elapsed / duration) * 100))
}
```

### API Endpoints Used

**Live Channel EPG:**
- Endpoint: `GET /api/epg/now-playing?channel_id={guideId}`
- Response: `EPGResponse` with `currentProgram: Program | null`
- Program fields: `title`, `startTime`, `endTime`, `description`

**Channel Data:**
- Channels from `useChannelStore` have `guideId` field for EPG lookup
- If no `guideId`, skip EPG fetch for that channel

### Type Definitions

```tsx
// From frontend/src/types/index.ts
interface Channel {
  id: string
  name: string
  streamUrl: string
  guideId: string  // Used for EPG lookup
}

interface Program {
  title: string
  startTime: string  // ISO 8601
  endTime: string    // ISO 8601
  description?: string
}

interface EPGResponse {
  channelId: string
  currentProgram: Program | null
  nextProgram?: Program | null
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/ChannelList.tsx` | Add EPG fetching, progress calculation, update ChannelItem UI |
| `frontend/src/components/ChannelList.test.tsx` | Add tests for EPG display and progress bars |

### Files to Reference

| File | Purpose |
|------|---------|
| `frontend/src/components/tv/TVChannelSidebar.tsx` | EPG fetching pattern (lines 22-52) |
| `frontend/src/components/tv/TVEPGGrid.tsx` | Time calculation patterns (lines 65-84) |
| `frontend/src/services/api.ts` | `fetchNowPlaying()` function (lines 163-174) |
| `frontend/src/types/index.ts` | Type definitions (Channel, Program, EPGResponse) |

### Project Structure Notes

- Component stays in `frontend/src/components/ChannelList.tsx`
- No new files needed - enhancing existing component
- Test file co-located: `ChannelList.test.tsx`
- All imports use `@/` path alias

### Styling Requirements (10-Foot UI)

- Maintain 56px minimum height for touch/focus targets
- Keep `text-lg` for primary text readability
- Use `text-sm` for programme title (secondary information)
- Progress bar: 4px height (`h-1`) for visibility without dominance
- Truncate long programme titles with `truncate` class

### Edge Cases

1. **No guideId**: Some channels may not have EPG mapping
   - Solution: Skip EPG fetch, show "No programme info"

2. **EPG fetch fails**: Backend may be unavailable
   - Solution: Silent fail, show "No programme info" for that channel

3. **Programme ends**: Current programme may have ended
   - Solution: Progress bar disappears, wait for next refresh to show new programme

4. **Very long programmes**: Progress may move slowly
   - Solution: 1-minute refresh is sufficient for visual feedback

5. **Modal opened mid-programme**: Need accurate progress
   - Solution: Calculate from current time, not modal open time

### Testing Checklist

- [ ] EPG data displays for channels with programmes
- [ ] "No programme info" displays for channels without EPG
- [ ] Progress bar shows correct percentage
- [ ] Progress bar updates over time
- [ ] EPG refreshes every 5 minutes
- [ ] Channels without guideId handled gracefully
- [ ] All existing channel selection tests still pass
- [ ] Keyboard navigation still works
- [ ] 10-foot UI standards maintained

### References

- [Source: frontend/src/components/ChannelList.tsx] - Current implementation
- [Source: frontend/src/components/tv/TVChannelSidebar.tsx:22-52] - EPG fetch pattern
- [Source: frontend/src/services/api.ts:163-174] - fetchNowPlaying API
- [Source: frontend/src/types/index.ts:30-41] - Program and EPGResponse types
- [Source: _bmad-output/project-context.md] - Project conventions

### Previous Story Intelligence

**From Story 12.1 (Route Consolidation):**
- AdminModal now has 5 tabs including Status placeholder
- All frontend tests pass (663 tests)
- Build succeeds with no errors

**From Story 12.7 (Rounded Corners):**
- Currently in review alongside 12.1
- No conflicts with this story

**Recent Git Activity:**
- `b53bf56` - bmad additions
- `6e1279d` - united view fixes
- `9e3d290` - epg fixes (relevant EPG improvements)
- TVChannelSidebar EPG pattern is stable and tested

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation was straightforward with no debugging issues.

### Completion Notes List

- ✅ Added `ChannelEPGData` interface and `calculateProgress` helper function to ChannelList.tsx
- ✅ Extended `ChannelItemProps` with `currentProgramme`, `programmeStart`, `programmeEnd`, and `currentTime` props
- ✅ Implemented EPG data fetching for all channels using `fetchNowPlaying` API call with Promise.all
- ✅ Added 5-minute interval for EPG data refresh to keep current programme info up-to-date
- ✅ Added 1-minute interval for `currentTime` state updates to keep progress bars accurate
- ✅ Updated ChannelItem UI layout to show channel name and programme title with progress bar
- ✅ Handles missing guideId gracefully by skipping EPG fetch for those channels
- ✅ Handles EPG fetch errors gracefully with silent fail pattern (non-critical data)
- ✅ Progress bar only displays when valid start/end times exist
- ✅ "No programme info" fallback text shown when no EPG data available
- ✅ Maintains 10-foot UI compliance with 56px min height and text-lg for readability
- ✅ Updated test file to mock `fetchNowPlaying` and added 7 new EPG-related tests
- ✅ All 670 frontend tests pass (25 in ChannelList.test.tsx specifically)
- ✅ Build and lint pass with no errors

### File List

| File | Action |
|------|--------|
| frontend/src/components/ChannelList.tsx | Modified - Added EPG data fetching, props, and UI layout |
| frontend/src/components/ChannelList.test.tsx | Modified - Added EPG tests and updated existing tests for new DOM structure |

### Change Log

| Date | Description |
|------|-------------|
| 2026-01-04 | Implemented Channel Card EPG Display - Story 12.6 complete |

