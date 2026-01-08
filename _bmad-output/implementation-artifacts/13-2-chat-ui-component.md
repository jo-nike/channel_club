# Story 13.2: Chat UI Component

Status: review

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

- [x] Task 1: Add VITE_CHAT_ENABLED environment variable (AC: #7)
  - [x] Add to `frontend/.env.development` and `frontend/.env.production`
  - [x] Add to frontend `.env.example`
  - [x] Create `useChatEnabled()` hook or config utility

- [x] Task 2: Create chat store (AC: #3, #4)
  - [x] Create `frontend/src/stores/chatStore.ts`
  - [x] State: `messages`, `isOpen`, `isLoading`
  - [x] Actions: `addMessage`, `setMessages`, `toggleOpen`, `setOpen`
  - [x] Define `ChatMessage` type in `types/index.ts`

- [x] Task 3: Extend useWebSocket for chat (AC: #3, #4)
  - [x] Handle `chat_message` and `chat_history` message types
  - [x] Add `sendChatMessage(content: string)` function
  - [x] Update chatStore when messages received
  - [x] Only process if chat enabled

- [x] Task 4: Create ChatMessage component (AC: #4)
  - [x] Create `frontend/src/components/ChatMessage.tsx`
  - [x] Display username, content, timestamp
  - [x] Style differently for own messages vs others
  - [x] Proper timestamp formatting (HH:MM or "just now")

- [x] Task 5: Create ChatPanel component (AC: #2, #5)
  - [x] Create `frontend/src/components/ChatPanel.tsx`
  - [x] Slide-in animation from right side
  - [x] Message list with auto-scroll on new messages
  - [x] Input field with Enter to send
  - [x] Send button for accessibility
  - [x] Close button in header

- [x] Task 6: Add chat toggle button (AC: #1, #7)
  - [x] Add to video controls area (both TVView and ErsatzTV views)
  - [x] Use MessageCircle icon from lucide-react
  - [x] Only render if chat enabled
  - [x] Show unread indicator when panel closed and new messages

- [x] Task 7: Mobile responsive layout (AC: #6)
  - [x] Full-width overlay on mobile (<768px)
  - [N/A] Swipe to dismiss gesture (close button available)
  - [x] Keyboard-aware input (avoid being covered)
  - [x] Custom sliding panel (similar to shadcn/ui Sheet)

- [x] Task 8: Add tests (AC: #1-7)
  - [x] Test chat toggle visibility based on env
  - [x] Test message sending
  - [x] Test message receiving and display
  - [x] Test panel open/close
  - [x] Test mobile layout

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

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - All tests pass, build succeeds

### Completion Notes List

1. Created `useChatEnabled` hook for environment variable checking
2. Implemented Zustand chat store with message management, unread count, and panel state
3. Extended `useWebSocket` hook to handle `chat_message` and `chat_history` message types
4. Created `ChatMessage` component with timestamp formatting and own-vs-other styling
5. Created `ChatPanel` with slide-in animation, auto-scroll, and message input
6. Created `ChatToggleButton` with unread badge (9+ max display)
7. Added chat toggle to both `VideoControls` and `ErsatzTVVideoControls`
8. Integrated `ChatPanel` into `TVView` with username from auth store
9. Updated `authStore` to persist username for own-message detection
10. All 794 tests pass (42 new chat-related tests)

### File List

**New Files:**
- `frontend/src/hooks/useChatEnabled.ts` - Hook to check VITE_CHAT_ENABLED
- `frontend/src/hooks/useChatEnabled.test.ts` - Tests (3)
- `frontend/src/stores/chatStore.ts` - Chat state management
- `frontend/src/stores/chatStore.test.ts` - Tests (13)
- `frontend/src/components/ChatMessage.tsx` - Individual message component
- `frontend/src/components/ChatMessage.test.tsx` - Tests (7)
- `frontend/src/components/ChatPanel.tsx` - Main chat panel with messages and input
- `frontend/src/components/ChatPanel.test.tsx` - Tests (11)
- `frontend/src/components/ChatToggleButton.tsx` - Video control button with unread badge
- `frontend/src/components/ChatToggleButton.test.tsx` - Tests (8)

**Modified Files:**
- `frontend/.env.development` - Added VITE_CHAT_ENABLED=true
- `frontend/.env.example` - Added VITE_CHAT_ENABLED documentation
- `frontend/src/types/index.ts` - Added ChatMessage interface
- `frontend/src/hooks/useWebSocket.ts` - Added chat message handlers and sendChatMessage
- `frontend/src/hooks/useWebSocket.test.ts` - Added 6 chat tests
- `frontend/src/stores/authStore.ts` - Added username to state
- `frontend/src/hooks/useAuth.ts` - Exposed username
- `frontend/src/components/LoginForm.tsx` - Pass username on local auth login
- `frontend/src/components/LoginForm.test.tsx` - Updated test expectations
- `frontend/src/components/VideoControls.tsx` - Added ChatToggleButton
- `frontend/src/components/ersatztv/ErsatzTVVideoControls.tsx` - Added ChatToggleButton
- `frontend/src/components/tv/TVView.tsx` - Added ChatPanel integration
