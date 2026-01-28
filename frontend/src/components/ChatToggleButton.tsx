import { MessageCircle } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function ChatToggleButton() {
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
          onClick={toggleOpen}
          aria-label={unreadCount > 0 ? `Open chat (${unreadCount} new)` : 'Open chat'}
          className="relative h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <MessageCircle className="h-4 w-4 shrink-0" />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
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
