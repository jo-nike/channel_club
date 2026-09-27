import { MessageCircle } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { HeaderAction } from '@/components/HeaderAction'

export function ChatToggleButton() {
  const chatEnabled = useChatEnabled()
  const { toggleOpen, unreadCount, isOpen } = useChatStore()

  // Don't render if chat is disabled
  if (!chatEnabled) {
    return null
  }

  // A disclosure for the chat panel (aria-expanded), not a pressed toggle
  return (
    <HeaderAction
      variant="default"
      icon={<MessageCircle />}
      label={unreadCount > 0 ? `Open chat (${unreadCount} new)` : 'Open chat'}
      visibleLabel="Chat"
      badge={unreadCount}
      aria-expanded={isOpen}
      aria-controls="chat-panel"
      onClick={toggleOpen}
    />
  )
}
