import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useSetLiveChannel } from '@/hooks/useSetLiveChannel'
import { fetchGroupedChannels } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ChatMessage as ChatMessageType } from '@/types'
import { detectMediaUrls } from '@/lib/mediaDetection'
import { MEMBER_COLOR_CLASS, memberColorStyle, memberKey } from '@/lib/memberColor'
import { formatClockTime } from '@/lib/utils'
import { ChatMediaEmbed } from './ChatMediaEmbed'
import { LivePill } from './LivePill'
import { MemberAvatar } from './MemberAvatar'

/**
 * The channel a message was sent from (the server's stamp) or a share card
 * shows, resolved against this viewer's channel list.
 */
export interface MessageChannel {
  name: string
  programme?: string | null
  // Live TV (channel 0): marked with the LIVE pill instead of a number
  live: boolean
  // The row's number in this viewer's list; absent when it isn't listed
  number?: number
  // Tune to it. Absent on your own messages, when you're on it already, or
  // when it can't be reached from here
  onJoin?: () => void
}

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
  // Where the sender was watching: a chip on a message ('on 2 Cartoons ·
  // Join'), or the card of a share. Omitted, a message has no chip and a
  // share shows its text
  channel?: MessageChannel
}

/** The channel's mark: the LIVE pill for channel 0, otherwise its number. */
function ChannelMark({ channel }: { channel: MessageChannel }) {
  if (channel.live) return <LivePill />
  if (channel.number === undefined) return null
  return <span className="font-display font-bold tabular-nums">{channel.number}</span>
}

/**
 * 'on 2 Cartoons · Join': where the sender was when they posted. Join is a
 * button of its own; the rest is text. (The spaces between the flex items
 * aren't drawn, but keep the words apart for screen readers.)
 */
function ChannelChip({ channel, sender }: { channel: MessageChannel; sender: string }) {
  return (
    <span data-slot="message-channel" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <span className="shrink-0">on</span>{' '}
      <ChannelMark channel={channel} />{' '}
      <span className="truncate">{channel.name}</span>
      {channel.onJoin && (
        <>
          {' '}<span aria-hidden="true">·</span>{' '}
          <Button
            variant="link"
            size="sm"
            className="h-auto shrink-0 p-0 text-xs"
            aria-label={`Join ${sender} on ${channel.name}`}
            onClick={channel.onJoin}
          >
            Join
          </Button>
        </>
      )}
    </span>
  )
}

/** A member's now-playing card: what they're watching, with Watch to go there. */
function ShareCard({ channel, sender, isOwn }: { channel: MessageChannel; sender: string; isOwn: boolean }) {
  return (
    <div
      data-slot="share-card"
      className="flex w-60 max-w-[85%] flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {isOwn ? "You're watching" : 'Watching'}
      </p>
      <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
        <ChannelMark channel={channel} />{' '}
        <span className="truncate">{channel.name}</span>
      </p>
      {channel.programme && <p className="truncate text-sm text-muted-foreground">{channel.programme}</p>}
      {channel.onJoin && (
        <Button
          size="sm"
          className="mt-1 self-start"
          aria-label={`Watch ${channel.name} with ${sender}`}
          onClick={channel.onJoin}
        >
          Watch
        </Button>
      )}
    </div>
  )
}

/**
 * A member's suggestion for live TV, with 'Put it on' for anyone allowed to
 * change live TV (not the admin panel's tune-in: they stay where they are,
 * and the Live line in chat offers Watch). The channel is looked up in the
 * catalogue on the click, so live TV gets its stream as the catalogue has it
 * now, not just a name. Once it's on air, the card says so instead.
 */
function SuggestionCard({ channelId, channelName, isOwn }: { channelId: string; channelName: string; isOwn: boolean }) {
  const isAdmin = useAuthStore((s) => s.role === 'admin')
  const canSwitch = useSettingsStore((s) => isAdmin || s.userChannelSelection)
  const onAir = useChannelStore((s) => s.currentChannel?.id === channelId)
  const setLiveChannel = useSetLiveChannel()
  const [putting, setPutting] = useState(false)

  async function putOn() {
    setPutting(true)
    try {
      const { groups, ungrouped } = await fetchGroupedChannels()
      const channel = [...groups.flatMap((group) => group.channels), ...ungrouped].find((c) => c.id === channelId)
      if (channel) {
        // Says itself why, if the switch is refused
        await setLiveChannel(channel)
      } else {
        toast.error(`Could not put ${channelName} on`, { description: "It's no longer in the channel list" })
      }
    } catch {
      toast.error(`Could not put ${channelName} on`, { description: 'Please try again' })
    } finally {
      setPutting(false)
    }
  }

  return (
    <div
      data-slot="suggestion-card"
      className="flex w-60 max-w-[85%] flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {isOwn ? 'You suggested for live TV' : 'Suggests for live TV'}
      </p>
      <p className="truncate text-sm font-semibold">{channelName}</p>
      {onAir ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LivePill /> On live TV now
        </p>
      ) : (
        canSwitch && (
          <Button
            size="sm"
            className="mt-1 self-start"
            aria-label={`Put ${channelName} on live TV`}
            disabled={putting}
            onClick={putOn}
          >
            Put it on
          </Button>
        )
      )}
    </div>
  )
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

  return formatClockTime(date)
}

/**
 * Render message content with inline media embeds
 * Parses URLs and renders them as embedded media when allowed, or as a
 * click-to-open link when not
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

    // Add the media embed, or a link to media that isn't embedded
    segments.push(
      match.kind === 'embed' ? (
        <ChatMediaEmbed
          key={`media-${match.startIndex}`}
          url={match.url}
          type={match.type}
        />
      ) : (
        <a
          key={`media-${match.startIndex}`}
          href={match.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 underline text-sm hover:text-blue-400"
        >
          {match.originalUrl}
        </a>
      )
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
  channel,
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

  const shareCard = message.kind === 'share' && channel
  // A suggestion names the channel suggested, never where the sender is
  const suggestion =
    message.kind === 'suggestion' && message.channelId && message.channelName
      ? { channelId: message.channelId, channelName: message.channelName }
      : null
  // The chip heads the sender's group (a new channel starts a new group)
  const chip = !shareCard && !suggestion && channel && isFirstInGroup ? channel : undefined

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
          <span className="flex max-w-full min-w-0 items-center gap-1.5 px-1">
            <span className="shrink-0 text-xs font-semibold text-(--member)">{message.username}</span>
            {chip && <ChannelChip channel={chip} sender={message.username} />}
          </span>
        )}
        {/* Yours has no name above it, so the chip stands alone */}
        {isOwn && chip && (
          <span className="flex max-w-full min-w-0 px-1">
            <ChannelChip channel={chip} sender={message.username} />
          </span>
        )}
        {shareCard ? (
          <ShareCard channel={shareCard} sender={message.username} isOwn={isOwn} />
        ) : suggestion ? (
          <SuggestionCard {...suggestion} isOwn={isOwn} />
        ) : (
          /* Your own bubble is tinted with your colour */
          <div
            className={`max-w-[85%] rounded-lg px-3 py-2 overflow-hidden text-foreground ${
              isOwn ? 'bg-member-surface' : 'bg-muted'
            }`}
          >
            {renderedContent}
          </div>
        )}
        {isLastInGroup && (
          <span className="text-xs text-muted-foreground px-1">{formattedTime}</span>
        )}
      </div>
    </div>
  )
}
