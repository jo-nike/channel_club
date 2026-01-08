import { MessageCircle } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface ChatToggleButtonProps {
  isVisible: boolean
}

export function ChatToggleButton({ isVisible }: ChatToggleButtonProps) {
  const chatEnabled = useChatEnabled()
  const { toggleOpen, unreadCount } = useChatStore()

  // Don't render if chat is disabled
  if (!chatEnabled) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          onClick={toggleOpen}
          aria-label={unreadCount > 0 ? `Open chat (${unreadCount} new)` : 'Open chat'}
          className="control-button relative flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
        >
          <MessageCircle className="h-6 w-6 text-white" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{unreadCount > 0 ? `Chat (${unreadCount} new)` : 'Chat'}</p>
      </TooltipContent>
    </Tooltip>
  )
}
