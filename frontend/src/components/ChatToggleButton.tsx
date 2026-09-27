import { MessageCircle } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { HeaderAction } from '@/components/HeaderAction'
import { withKey } from '@/lib/keyHints'

export function ChatToggleButton() {
  const chatEnabled = useChatEnabled()
  // Field selectors: the button re-renders for its count and state, not on
  // every message
  const toggleOpen = useChatStore((s) => s.toggleOpen)
  const unreadCount = useChatStore((s) => s.unreadCount)
  const isOpen = useChatStore((s) => s.isOpen)

  // Don't render if chat is disabled
  if (!chatEnabled) {
    return null
  }

  // A disclosure for the chat panel (aria-expanded), not a pressed toggle.
  // Its name stays 'Chat' open or closed, so it reads "Chat, expanded".
  // The filled button gets a ring while open, so the state shows as well.
  const label = unreadCount > 0 ? `Chat, ${unreadCount} new` : 'Chat'
  return (
    <HeaderAction
      variant="default"
      icon={<MessageCircle />}
      label={label}
      tooltip={withKey(label, 'C')}
      visibleLabel="Chat"
      badge={unreadCount}
      aria-expanded={isOpen}
      aria-controls="chat-panel"
      aria-keyshortcuts="C"
      className="aria-expanded:ring-2 aria-expanded:ring-primary aria-expanded:ring-offset-2 aria-expanded:ring-offset-background"
      onClick={toggleOpen}
    />
  )
}
