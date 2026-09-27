import { useMemo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { ChatMessage as ChatMessageType } from '@/types'
import { detectMediaUrls } from '@/lib/mediaDetection'
import { MEMBER_COLOR_CLASS, memberColorStyle, memberKey } from '@/lib/memberColor'
import { ChatMediaEmbed } from './ChatMediaEmbed'
import { MemberAvatar } from './MemberAvatar'

export interface ChatMessageProps {
  message: ChatMessageType
  isOwn?: boolean
  // The current time (ms) from the panel's shared tick, so 'just now' moves on
  now: number
  // Consecutive messages from one sender form a group: the name shows on the
  // first bubble, the time on the last
  isFirstInGroup?: boolean
  isLastInGroup?: boolean
  // On a system line: go to Live (channel 0). Omitted, the line has no Watch
  onWatch?: () => void
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

export function ChatMessage({
  message,
  isOwn = false,
  now,
  isFirstInGroup = true,
  isLastInGroup = true,
  onWatch,
}: ChatMessageProps) {
  const formattedTime = formatTimestamp(message.timestamp, now)

  const renderedContent = useMemo(
    () => renderContent(message.content),
    [message.content]
  )

  // A line from the server about Live, between rules across the panel: no
  // sender, face or bubble, and the text as sent (no media embeds)
  if (message.kind === 'system') {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-muted-foreground">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <p className="min-w-0 text-center break-words">
          {message.content} · {formattedTime}
        </p>
        {onWatch && (
          <Button variant="link" size="sm" className="h-auto shrink-0 p-0 text-xs" onClick={onWatch}>
            Watch
          </Button>
        )}
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
    )
  }

  // Other people's names and faces, and your own bubble, take the sender's member colour
  return (
    <div
      style={memberColorStyle(memberKey(message))}
      className={`${MEMBER_COLOR_CLASS} flex items-start gap-2 px-3 ${isFirstInGroup ? 'pt-1.5' : 'pt-0.5'} ${
        isLastInGroup ? 'pb-1.5' : 'pb-0.5'
      }`}
    >
      {/* The face opens someone's group; later bubbles keep its column */}
      {!isOwn &&
        (isFirstInGroup ? (
          <MemberAvatar username={message.username} userId={message.userId} decorative />
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        ))}
      <div className={`flex min-w-0 flex-1 flex-col gap-0.5 ${isOwn ? 'items-end' : 'items-start'}`}>
        {/* Above the bubble, on the panel, where the member colours keep 4.5:1 */}
        {!isOwn && isFirstInGroup && (
          <span className="px-1 text-xs font-semibold text-(--member)">{message.username}</span>
        )}
        {/* Your own bubble is tinted with your colour */}
        <div
          className={`max-w-[85%] rounded-lg px-3 py-2 overflow-hidden text-foreground ${
            isOwn ? 'bg-member-surface' : 'bg-muted'
          }`}
        >
          {renderedContent}
        </div>
        {isLastInGroup && (
          <span className="text-xs text-muted-foreground px-1">{formattedTime}</span>
        )}
      </div>
    </div>
  )
}
