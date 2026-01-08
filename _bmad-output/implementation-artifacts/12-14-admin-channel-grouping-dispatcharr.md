# Story 12.14: Admin Channel Grouping (Dispatcharr)

Status: ready-for-dev

## Story

As an admin,
I want channels organized into collapsible groups,
So that I can navigate a long channel list more efficiently.

## Acceptance Criteria

1. **Given** I open the admin modal "Channels" tab, **when** the channel list renders, **then** channels are organized into collapsible group sections

2. **Given** channel groups exist, **when** viewing the list, **then** each group has a header showing group name and channel count **and** groups are collapsed by default

3. **Given** I click on a group header, **when** the group expands, **then** I see all channels within that group **and** I can collapse it again by clicking the header

4. **Given** I search/filter channels, **when** matches are found, **then** matching channels are shown with their groups auto-expanded

## Tasks / Subtasks

- [ ] Task 1: Create Backend Channel Groups Endpoint (AC: #1, #2)
  - [ ] Add `GET /api/channels/grouped` endpoint to `backend/app/routers/channels.py`
  - [ ] Call Dispatcharr `/api/channels/groups/` to get groups
  - [ ] Call Dispatcharr `/api/channels/channels/` to get channels with `channel_group_id`
  - [ ] Map channels to groups and return structured response
  - [ ] Handle channels with no group (put in "Ungrouped" section)

- [ ] Task 2: Create Pydantic Models for Grouped Channels (AC: #1)
  - [ ] Add `ChannelGroup` model to `backend/app/models/channel.py`
  - [ ] Add `GroupedChannelsResponse` model
  - [ ] Ensure camelCase JSON serialization

- [ ] Task 3: Update Dispatcharr Service (AC: #1)
  - [ ] Add `get_channel_groups()` function to fetch groups
  - [ ] Add `get_channels_with_groups()` function to fetch full channel data
  - [ ] Handle authentication if required (JWT token)

- [ ] Task 4: Update Frontend API Service (AC: #1)
  - [ ] Add `fetchGroupedChannels()` to `frontend/src/services/api.ts`
  - [ ] Define TypeScript types for `ChannelGroup` and grouped response

- [ ] Task 5: Create CollapsibleChannelGroup Component (AC: #2, #3)
  - [ ] Create `frontend/src/components/CollapsibleChannelGroup.tsx`
  - [ ] Use shadcn/ui Collapsible component
  - [ ] Display group name and channel count in header
  - [ ] Animate expand/collapse with ChevronDown icon rotation
  - [ ] Default to collapsed state

- [ ] Task 6: Update ChannelList Component (AC: #1, #2, #3)
  - [ ] Modify to use grouped channels endpoint
  - [ ] Render CollapsibleChannelGroup for each group
  - [ ] Keep existing channel selection logic within groups
  - [ ] Maintain keyboard navigation across groups

- [ ] Task 7: Add Channel Search/Filter (AC: #4)
  - [ ] Add search input to channel list header
  - [ ] Filter channels by name (case-insensitive)
  - [ ] Auto-expand groups containing matching channels
  - [ ] Show "No matches" message when no results

- [ ] Task 8: Write Backend Tests (AC: #1, #2)
  - [ ] Add tests to `backend/tests/routers/test_channels.py`
  - [ ] Test grouped endpoint with mocked Dispatcharr responses
  - [ ] Test ungrouped channels handling
  - [ ] Test error handling when Dispatcharr unavailable

- [ ] Task 9: Write Frontend Tests (AC: #1, #2, #3, #4)
  - [ ] Create `frontend/src/components/CollapsibleChannelGroup.test.tsx`
  - [ ] Update `frontend/src/components/ChannelList.test.tsx`
  - [ ] Test expand/collapse behavior
  - [ ] Test search filtering and auto-expand

- [ ] Task 10: Build and Test
  - [ ] Run `uv run pytest` - all tests pass
  - [ ] Run `npm run test` - all tests pass
  - [ ] Run `npm run build` - builds successfully
  - [ ] Manual testing with actual Dispatcharr data

## Dev Notes

### Pre-Implementation Research Complete

**Dispatcharr API Investigation Results:**

The Dispatcharr API provides full group support:

1. **`GET /api/channels/groups/`** - Returns all channel groups:
   ```json
   [
     {"id": 1, "name": "Sports", "channel_count": 15},
     {"id": 2, "name": "News", "channel_count": 8}
   ]
   ```

2. **`GET /api/channels/channels/`** - Returns channels with `channel_group_id`:
   ```json
   [
     {
       "id": 1,
       "name": "TSN",
       "channel_number": 5,
       "channel_group_id": 1,
       "uuid": "0a394a85-c369-4b08-b083-465f2149fc2d",
       ...
     }
   ]
   ```

3. **`/hdhr/lineup.json`** - Does NOT include group info (HDHomeRun simplified format)

**Note:** These Dispatcharr API endpoints require JWT authentication. The backend will need to obtain a token or use existing credentials.

### API Response Format

```typescript
// Backend response
interface GroupedChannelsResponse {
  groups: ChannelGroupWithChannels[]
  ungrouped: Channel[]
}

interface ChannelGroupWithChannels {
  id: number
  name: string
  channelCount: number
  channels: Channel[]
}
```

### Component Structure

```tsx
// CollapsibleChannelGroup.tsx
<Collapsible open={isOpen} onOpenChange={setIsOpen}>
  <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-accent rounded-lg">
    <div className="flex items-center gap-2">
      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
      <span className="font-medium">{group.name}</span>
    </div>
    <Badge variant="secondary">{group.channelCount}</Badge>
  </CollapsibleTrigger>
  <CollapsibleContent>
    {group.channels.map(channel => (
      <ChannelItem key={channel.id} channel={channel} ... />
    ))}
  </CollapsibleContent>
</Collapsible>
```

### Search Filter Logic

```typescript
// Filter groups and channels
const filterChannels = (groups: ChannelGroupWithChannels[], query: string) => {
  if (!query.trim()) return { groups, expandedIds: new Set<number>() }

  const lowerQuery = query.toLowerCase()
  const expandedIds = new Set<number>()

  const filteredGroups = groups.map(group => {
    const matchingChannels = group.channels.filter(ch =>
      ch.name.toLowerCase().includes(lowerQuery)
    )
    if (matchingChannels.length > 0) {
      expandedIds.add(group.id)
    }
    return { ...group, channels: matchingChannels }
  }).filter(g => g.channels.length > 0)

  return { groups: filteredGroups, expandedIds }
}
```

### Dispatcharr Authentication

The Dispatcharr API uses JWT authentication:
- `POST /api/accounts/token/` - Obtain token with username/password
- Token format: `Authorization: Bearer <token>`

**Options:**
1. Store Dispatcharr credentials in environment variables
2. Use service account for backend-to-backend calls
3. Proxy through existing auth if user has Dispatcharr access

**Recommendation:** Add `DISPATCHARR_USERNAME` and `DISPATCHARR_PASSWORD` env vars for backend service account access.

### Project Structure Notes

**Files to Create:**
- `frontend/src/components/CollapsibleChannelGroup.tsx`
- `frontend/src/components/CollapsibleChannelGroup.test.tsx`

**Files to Modify:**
- `backend/app/models/channel.py` - Add group models
- `backend/app/routers/channels.py` - Add grouped endpoint
- `backend/app/services/dispatcharr.py` - Add group fetching
- `backend/app/config.py` - Add Dispatcharr credentials
- `frontend/src/services/api.ts` - Add grouped channels API
- `frontend/src/components/ChannelList.tsx` - Use grouped data
- `frontend/src/types/index.ts` - Add group types

### Environment Variables

Add to backend `.env`:
```
DISPATCHARR_USERNAME=admin
DISPATCHARR_PASSWORD=your-password
```

### Keyboard Navigation Considerations

Groups should be keyboard navigable:
- Arrow Up/Down: Navigate between groups and channels
- Enter/Space on group header: Toggle expand/collapse
- Enter/Space on channel: Select channel
- Tab: Move focus through interactive elements

### References

- [Source: swagger.json] - Dispatcharr API documentation
- [Source: backend/app/services/dispatcharr.py] - Existing Dispatcharr integration
- [Source: frontend/src/components/ChannelList.tsx] - Current channel list implementation

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
