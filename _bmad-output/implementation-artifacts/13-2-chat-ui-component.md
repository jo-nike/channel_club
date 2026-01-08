# Story 13.2: Chat UI Component

Status: ready-for-dev

## Story

As a user,
I want an optional chat overlay while watching,
so that I can communicate with other viewers.

## Acceptance Criteria

1. **Given** `CHAT_ENABLED=true` and I am viewing video
   **When** the UI renders
   **Then** I see a chat toggle button in the video controls area

2. **Given** I click the chat toggle button
   **When** the chat opens
   **Then** a chat panel slides in from the right side
   **And** I see recent messages
   **And** I see a message input field at the bottom

3. **Given** the chat panel is open
   **When** I type a message and press Enter (or click Send)
   **Then** my message is sent via WebSocket
   **And** it appears in the chat with my username

4. **Given** another user sends a message
   **When** I have the chat open
   **Then** the new message appears in real-time
   **And** the chat auto-scrolls to show new messages

5. **Given** the chat panel is open
   **When** I click the close button or toggle
   **Then** the panel slides out
   **And** video viewing is unobstructed

6. **Given** I am on mobile
   **When** the chat is open
   **Then** the chat panel is full-width overlay (not side panel)
   **And** I can dismiss with swipe or close button

7. **Given** `CHAT_ENABLED=false`
   **When** the UI renders
   **Then** no chat toggle button is visible

## Tasks / Subtasks

- [ ] Task 1: Add VITE_CHAT_ENABLED environment variable (AC: #7)
  - [ ] Add to `frontend/.env.development` and `frontend/.env.production`
  - [ ] Add to frontend `.env.example`
  - [ ] Create `useChatEnabled()` hook or config utility

- [ ] Task 2: Create chat store (AC: #3, #4)
  - [ ] Create `frontend/src/stores/chatStore.ts`
  - [ ] State: `messages`, `isOpen`, `isLoading`
  - [ ] Actions: `addMessage`, `setMessages`, `toggleOpen`, `setOpen`
  - [ ] Define `ChatMessage` type in `types/index.ts`

- [ ] Task 3: Extend useWebSocket for chat (AC: #3, #4)
  - [ ] Handle `chat_message` and `chat_history` message types
  - [ ] Add `sendChatMessage(content: string)` function
  - [ ] Update chatStore when messages received
  - [ ] Only process if chat enabled

- [ ] Task 4: Create ChatMessage component (AC: #4)
  - [ ] Create `frontend/src/components/ChatMessage.tsx`
  - [ ] Display username, content, timestamp
  - [ ] Style differently for own messages vs others
  - [ ] Proper timestamp formatting (HH:MM or "just now")

- [ ] Task 5: Create ChatPanel component (AC: #2, #5)
  - [ ] Create `frontend/src/components/ChatPanel.tsx`
  - [ ] Slide-in animation from right side
  - [ ] Message list with auto-scroll on new messages
  - [ ] Input field with Enter to send
  - [ ] Send button for accessibility
  - [ ] Close button in header

- [ ] Task 6: Add chat toggle button (AC: #1, #7)
  - [ ] Add to video controls area (both TVView and ErsatzTV views)
  - [ ] Use MessageCircle icon from lucide-react
  - [ ] Only render if chat enabled
  - [ ] Show unread indicator when panel closed and new messages

- [ ] Task 7: Mobile responsive layout (AC: #6)
  - [ ] Full-width overlay on mobile (<768px)
  - [ ] Swipe to dismiss gesture
  - [ ] Keyboard-aware input (avoid being covered)
  - [ ] Use shadcn/ui Sheet component for mobile

- [ ] Task 8: Add tests (AC: #1-7)
  - [ ] Test chat toggle visibility based on env
  - [ ] Test message sending
  - [ ] Test message receiving and display
  - [ ] Test panel open/close
  - [ ] Test mobile layout

## Dev Notes

### WebSocket Message Types

```typescript
// types/index.ts - add ChatMessage type
export interface ChatMessage {
  messageId: string
  username: string
  content: string
  timestamp: string // ISO8601
}

// In useWebSocket.ts - message handling
case 'chat_message':
  chatStore.getState().addMessage(message as ChatMessage)
  break

case 'chat_history':
  chatStore.getState().setMessages(message.messages as ChatMessage[])
  break
```

### Chat Store Pattern

Follow existing Zustand patterns from `authStore.ts` and `channelStore.ts`:

```typescript
// frontend/src/stores/chatStore.ts
import { create } from 'zustand'
import type { ChatMessage } from '@/types'

interface ChatState {
  messages: ChatMessage[]
  isOpen: boolean
  unreadCount: number
  addMessage: (message: ChatMessage) => void
  setMessages: (messages: ChatMessage[]) => void
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  clearUnread: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  unreadCount: 0,
  addMessage: (message) => set((state) => {
    const newMessages = [...state.messages, message].slice(-100) // Keep last 100
    return {
      messages: newMessages,
      unreadCount: state.isOpen ? 0 : state.unreadCount + 1,
    }
  }),
  setMessages: (messages) => set({ messages }),
  toggleOpen: () => set((state) => ({
    isOpen: !state.isOpen,
    unreadCount: !state.isOpen ? 0 : state.unreadCount,
  })),
  setOpen: (open) => set({
    isOpen: open,
    unreadCount: open ? 0 : get().unreadCount,
  }),
  clearUnread: () => set({ unreadCount: 0 }),
}))
```

### Component Structure

```
frontend/src/components/
├── ChatPanel.tsx          # Main panel with message list + input
├── ChatMessage.tsx        # Individual message component
├── ChatToggleButton.tsx   # Button for video controls
└── chat/                  # (optional) folder if components grow
```

### Chat Toggle Button Location

Add to video controls (similar to HighlightButton placement):

```tsx
// In VideoControls.tsx or ErsatzTVVideoControls.tsx
{chatEnabled && (
  <ChatToggleButton />
)}
```

### Mobile Sheet Component

Use shadcn/ui Sheet for mobile (already installed):

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

// Mobile: full-screen sheet
// Desktop: side panel with fixed width
```

### Auto-Scroll Implementation

```tsx
const messagesEndRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
}, [messages])

// In render:
<div className="overflow-y-auto flex-1">
  {messages.map(m => <ChatMessage key={m.messageId} message={m} />)}
  <div ref={messagesEndRef} />
</div>
```

### Environment Variable Access

```typescript
// frontend/src/lib/config.ts
export const isChatEnabled = () => {
  return import.meta.env.VITE_CHAT_ENABLED === 'true'
}
```

### Unread Indicator

Show badge on chat toggle button when panel is closed and new messages arrive:

```tsx
{unreadCount > 0 && (
  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
    {unreadCount > 9 ? '9+' : unreadCount}
  </span>
)}
```

### Project Structure Notes

- New files:
  - `frontend/src/components/ChatPanel.tsx`
  - `frontend/src/components/ChatMessage.tsx`
  - `frontend/src/components/ChatToggleButton.tsx`
  - `frontend/src/stores/chatStore.ts`
- Modified files:
  - `frontend/src/hooks/useWebSocket.ts` - add chat handlers
  - `frontend/src/types/index.ts` - add ChatMessage type
  - `frontend/src/components/tv/TVView.tsx` - add toggle button
  - `frontend/src/components/VideoControls.tsx` - add toggle button

### References

- [Source: _bmad-output/architecture.md#Frontend Organization]
- [Source: _bmad-output/architecture.md#2026-01-07: Epic 12 Extensions & Epic 13]
- [Source: frontend/src/hooks/useWebSocket.ts] - WebSocket message handling pattern
- [Source: frontend/src/stores/channelStore.ts] - Zustand store pattern
- [Source: frontend/src/components/HighlightButton.tsx] - Video control button pattern
- [Source: _bmad-output/project-context.md#TypeScript/React Rules]

### Dependency on Story 13.1

This story **requires** story 13-1 (WebSocket Chat Backend) to be completed first. The backend must:
- Handle `chat_message` incoming messages
- Broadcast to all clients
- Send `chat_history` on connect

Without the backend, the frontend will send messages but never receive them back.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
