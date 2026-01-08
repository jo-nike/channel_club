import { useMemo } from 'react'
import type { ChatMessage as ChatMessageType } from '@/types'

export interface ChatMessageProps {
  message: ChatMessageType
  isOwn?: boolean
}

/**
 * Format timestamp to display time only (HH:MM)
 * For recent messages (< 1 minute), shows "just now"
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) {
    return 'just now'
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function ChatMessage({ message, isOwn = false }: ChatMessageProps) {
  const formattedTime = useMemo(
    () => formatTimestamp(message.timestamp),
    [message.timestamp]
  )

  return (
    <div
      className={`flex flex-col gap-0.5 px-3 py-1.5 ${
        isOwn ? 'items-end' : 'items-start'
      }`}
    >
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isOwn
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        }`}
      >
        {!isOwn && (
          <span className="block text-xs font-semibold text-muted-foreground mb-0.5">
            {message.username}
          </span>
        )}
        <p className="text-sm break-words whitespace-pre-wrap">{message.content}</p>
      </div>
      <span className="text-xs text-muted-foreground px-1">{formattedTime}</span>
    </div>
  )
}
