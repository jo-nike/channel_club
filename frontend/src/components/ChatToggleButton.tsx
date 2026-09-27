import { MessageCircle } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { HeaderAction } from '@/components/HeaderAction'
import { withKey } from '@/lib/keyHints'

export function ChatToggleButton() {
  const chatEnabled = useChatEnabled()
  const { toggleOpen, unreadCount, isOpen } = useChatStore()

  // Don't render if chat is disabled
  if (!chatEnabled) {
    return null
  }

  // A disclosure for the chat panel (aria-expanded), not a pressed toggle.
  // Its name stays 'Chat' open or closed, so it reads "Chat, expanded".
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
      onClick={toggleOpen}
    />
  )
}
