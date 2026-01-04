# Story 11.2: Channel Selection Tab (Live TV)

Status: review

## Story

As an admin,
I want to select channels from within the admin modal,
So that channel control is consolidated with other admin functions.

## Acceptance Criteria

1. **Given** I am on Live TV view and open the admin modal, **when** I navigate to the "Channels" tab, **then** I see a "Clear Channel" option at the top followed by the existing channel list component
2. **Given** I select a channel from the modal, **when** selection completes, **then** the channel changes for all viewers **and** the modal closes automatically
3. **Given** I click "Clear Channel", **when** the action completes, **then** the current channel is cleared for all viewers **and** the modal closes
4. **Given** no channel is selected, **when** any viewer views the video player area, **then** they see a message: "No live TV channel currently selected"

## Tasks / Subtasks

- [x] Task 1: Integrate ChannelList into AdminModal Channels tab (AC: #1)
  - [x] Import ChannelList component into AdminModal
  - [x] Render ChannelList when "Channels" tab is active
  - [x] Ensure proper scrolling within modal content area
  - [x] Verify loading and error states work correctly in modal context

- [x] Task 2: Add modal close callback on channel selection (AC: #2)
  - [x] Add `onChannelSelected?: () => void` prop to ChannelList
  - [x] Call this callback after successful channel selection in ChannelList
  - [x] In AdminModal, pass callback that closes modal via `onOpenChange(false)`

- [x] Task 3: Remove auto-close from ChannelList sidebar behavior (AC: #2)
  - [x] In ChannelList, check if `onChannelSelected` prop exists
  - [x] If prop exists: call it instead of `setSidebarOpen(false)`
  - [x] If prop doesn't exist: keep existing sidebar close behavior
  - [x] This maintains backward compatibility while enabling modal close

- [x] Task 4: Style adjustments for modal context
  - [x] Ensure ChannelList height is constrained within dialog
  - [x] Consider max-height with scroll for many channels
  - [x] Maintain consistent padding with other modal content

- [x] Task 5: Add "Clear Channel" option at top of channel list (AC: #1, #3)
  - [x] Add `clearCurrentChannel` API function in `frontend/src/services/api.ts`
  - [x] Add "Clear Channel" button/item at top of ChannelList (before channel items)
  - [x] Style distinctly (e.g., destructive variant or icon with X)
  - [x] Only show when a channel is currently selected
  - [x] Call API to clear channel on click
  - [x] Close modal after clearing

- [x] Task 6: Add backend endpoint to clear channel (AC: #3)
  - [x] Add `DELETE /api/channels/current` endpoint in backend
  - [x] Use `require_admin` dependency
  - [x] Set `_current_channel = None` in channel_state
  - [x] Broadcast `channel_update` with `null` channel to all WebSocket clients

- [x] Task 7: Update VideoPlayer to show "no channel" message (AC: #4)
  - [x] In VideoPlayer component, check if `currentChannel` is null
  - [x] Display centered message: "No live TV channel currently selected"
  - [x] Style consistently with other empty states (muted text, centered)

## Dev Notes

### Architecture Patterns

**Clear Channel Backend Endpoint (`backend/app/routers/channels.py`):**

```python
@router.delete("/channels/current")
async def clear_current_channel(
    current_user: TokenPayload = Depends(require_admin),
) -> dict:
    """Clear the current channel selection."""
    log.info("Admin {} clearing current channel", current_user.sub)
    await channel_state.clear_current_channel()
    return {"status": "cleared"}
```

**Channel State Service Addition (`backend/app/services/channel_state.py`):**

```python
async def clear_current_channel() -> None:
    """Clear the current channel and broadcast to all clients."""
    global _current_channel
    _current_channel = None
    log.info("Current channel cleared")
    await broadcast({"type": "channel_update", "channel": None})
```

**Frontend API Function (`frontend/src/services/api.ts`):**

```typescript
export async function clearCurrentChannel(): Promise<void> {
  const token = localStorage.getItem('token')
  const response = await fetch(`${API_BASE_URL}/api/channels/current`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  if (!response.ok) {
    throw new Error('Failed to clear channel')
  }
}
```

**Clear Channel Button in ChannelList:**

```tsx
// At the top of the channel list, before the map
{currentChannel && (
  <button
    onClick={handleClearChannel}
    className={cn(
      'flex items-center gap-3 rounded-lg border border-destructive/50 p-4 transition-colors',
      'text-lg text-destructive',
      'min-h-[56px] w-full mb-2',
      'cursor-pointer hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    )}
  >
    <X className="h-5 w-5" />
    <span className="font-medium">Clear Channel</span>
  </button>
)}
```

**VideoPlayer No Channel Message (`frontend/src/components/VideoPlayer.tsx`):**

```tsx
// Add check at the beginning of the component render
if (!currentChannel) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <p className="text-lg text-muted-foreground">
        No live TV channel currently selected
      </p>
    </div>
  )
}
```

---

**ChannelList Enhancement:**
The existing ChannelList component needs a minor modification to support an optional callback:

```tsx
// In ChannelList.tsx
interface ChannelListProps {
  onChannelSelected?: () => void  // NEW optional prop
}

export function ChannelList({ onChannelSelected }: ChannelListProps = {}) {
  // ... existing code ...

  const handleSelectChannel = useCallback(async (channel: Channel) => {
    if (!isAdmin) return

    const previousChannel = currentChannel
    setCurrentChannel(channel)

    // If callback provided (modal context), call it
    // Otherwise use existing sidebar close behavior
    if (onChannelSelected) {
      onChannelSelected()
    } else {
      setSidebarOpen(false)
    }

    try {
      await setCurrentChannelApi(channel)
    } catch (e) {
      setCurrentChannel(previousChannel)
      toast.error('Failed to change channel', {
        description: e instanceof Error ? e.message : 'Please try again',
      })
    }
  }, [isAdmin, currentChannel, setCurrentChannel, setSidebarOpen, onChannelSelected])
```

**AdminModal Integration:**

```tsx
// In AdminModal.tsx - Channels tab content
{activeTab === 'channels' && (
  <div className="max-h-[60vh] overflow-hidden">
    <ChannelList onChannelSelected={() => onOpenChange(false)} />
  </div>
)}
```

### Existing ChannelList Analysis

**File:** `frontend/src/components/ChannelList.tsx`

**Current Behavior:**
- Uses `useChannelStore` for channels state
- Uses `useAuthStore` for role checking
- Calls `setSidebarOpen(false)` after selection (line 28)
- Has loading/error states built in
- Uses ScrollArea for overflow

**Key Functions:**
- `handleSelectChannel` - optimistic update, API call, rollback on error
- `loadChannels` - fetches channel list on mount

**Dependencies:**
- `@/stores/channelStore`
- `@/stores/authStore`
- `@/stores/uiStore` (for sidebar)
- `@/services/api` (fetchChannels, setCurrentChannel)

### Modal Content Styling

**Height Constraint Pattern:**
```tsx
<DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
  <DialogHeader>
    <DialogTitle>Admin Panel</DialogTitle>
  </DialogHeader>

  {/* Tab navigation */}
  <div className="border-b shrink-0">...</div>

  {/* Tab content - scrollable */}
  <div className="flex-1 min-h-0 overflow-auto">
    {activeTab === 'channels' && (
      <ChannelList onChannelSelected={() => onOpenChange(false)} />
    )}
  </div>
</DialogContent>
```

### Dependencies

**No new dependencies required.** This story reuses:
- Existing ChannelList component
- Existing channel API services
- Existing stores

### Project Structure Notes

- Minor modification to existing ChannelList.tsx (backward compatible)
- Integration code goes in AdminModal.tsx (from Story 11.1)
- No new files created in this story

### References

- [Source: frontend/src/components/ChannelList.tsx] - Full component implementation
- [Source: frontend/src/components/ChannelList.tsx:20-39] - handleSelectChannel function
- [Source: frontend/src/components/ChannelList.tsx:86-110] - Render structure with ScrollArea
- [Source: frontend/src/stores/channelStore.ts] - Channel state management
- [Source: frontend/src/services/api.ts] - setCurrentChannel API call (add clearCurrentChannel here)
- [Source: frontend/src/components/VideoPlayer.tsx] - Video player component (add no-channel message)
- [Source: backend/app/routers/channels.py] - Channel routes (add DELETE endpoint)
- [Source: backend/app/services/channel_state.py] - Channel state service (add clear_current_channel)

### Previous Story Intelligence

**Story 11.1** creates the AdminModal shell. This story fills in the Channels tab content. Ensure:
- Tab container structure from 11.1 supports scrollable content
- Modal max-height allows room for channel list
- Focus management doesn't conflict with ChannelList keyboard nav

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation proceeded smoothly.

### Completion Notes List

- ✅ Integrated ChannelList component into AdminModal Channels tab with `onChannelSelected` callback
- ✅ Added `clearCurrentChannel` API function in frontend (DELETE /api/channels/current)
- ✅ Added Clear Channel button at top of ChannelList (only shown when channel is selected)
- ✅ Added backend DELETE /api/channels/current endpoint with admin-only access
- ✅ Added `clear_current_channel_async` service method that broadcasts null channel to WebSocket clients
- ✅ Updated VideoPlayer placeholder message to "No live TV channel currently selected"
- ✅ All new tests pass (54 frontend tests, 29 backend channel tests)
- ✅ Backward compatibility maintained - ChannelList works both in sidebar and modal contexts

### File List

**Frontend (modified):**
- frontend/src/components/AdminModal.tsx
- frontend/src/components/AdminModal.test.tsx
- frontend/src/components/ChannelList.tsx
- frontend/src/components/VideoPlayer.tsx
- frontend/src/components/VideoPlayer.test.tsx
- frontend/src/services/api.ts

**Backend (modified):**
- backend/app/routers/channels.py
- backend/app/services/channel_state.py
- backend/tests/routers/test_channels.py

## Change Log

- 2026-01-04: Implemented Story 11.2 - Channel Selection Tab (Live TV)
