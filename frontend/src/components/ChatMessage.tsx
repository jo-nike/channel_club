import { useMemo, type ReactNode } from 'react'
import type { ChatMessage as ChatMessageType } from '@/types'
import { detectMediaUrls } from '@/lib/mediaDetection'
import { ChatMediaEmbed } from './ChatMediaEmbed'

export interface ChatMessageProps {
  message: ChatMessageType
  isOwn?: boolean
  // The current time (ms) from the panel's shared tick, so 'just now' moves on
  now: number
}

/**
 * Format timestamp to display time only (HH:MM)
 * For recent messages (< 1 minute before now), shows "just now"
 */
function formatTimestamp(timestamp: string, now: number): string {
  const date = new Date(timestamp)
  const diffMs = now - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) {
    return 'just now'
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Render message content with inline media embeds
 * Parses URLs and renders them as embedded media when applicable
 */
function renderContent(content: string): ReactNode {
  const mediaMatches = detectMediaUrls(content)

  // No media URLs - render as plain text
  if (mediaMatches.length === 0) {
    return (
      <p className="text-sm break-words whitespace-pre-wrap">{content}</p>
    )
  }

  // Split content into segments (text + media)
  const segments: ReactNode[] = []
  let lastIndex = 0

  for (const match of mediaMatches) {
    // Add text before the media URL
    if (match.startIndex > lastIndex) {
      const textBefore = content.slice(lastIndex, match.startIndex)
      segments.push(
        <span key={`text-${lastIndex}`} className="whitespace-pre-wrap">
          {textBefore}
        </span>
      )
    }

    // Add the media embed
    segments.push(
      <ChatMediaEmbed
        key={`media-${match.startIndex}`}
        url={match.url}
        type={match.type}
      />
    )

    lastIndex = match.endIndex
  }

  // Add any remaining text after the last media URL
  if (lastIndex < content.length) {
    const textAfter = content.slice(lastIndex)
    segments.push(
      <span key={`text-${lastIndex}`} className="whitespace-pre-wrap">
        {textAfter}
      </span>
    )
  }

  return <div className="flex flex-col gap-1 text-sm break-words">{segments}</div>
}

export function ChatMessage({ message, isOwn = false, now }: ChatMessageProps) {
  const formattedTime = formatTimestamp(message.timestamp, now)

  const renderedContent = useMemo(
    () => renderContent(message.content),
    [message.content]
  )

  return (
    <div
      className={`flex flex-col gap-0.5 px-3 py-1.5 ${
        isOwn ? 'items-end' : 'items-start'
      }`}
    >
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 overflow-hidden ${
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
        {renderedContent}
      </div>
      <span className="text-xs text-muted-foreground px-1">{formattedTime}</span>
    </div>
  )
}
