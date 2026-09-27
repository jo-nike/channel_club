import { Fragment, useRef, useEffect, useLayoutEffect, useState, useCallback, type KeyboardEvent, type UIEvent } from 'react'
import { X, Send, Pencil, Loader2, AlertCircle, WifiOff, ArrowDown } from 'lucide-react'
import type { ChatSendResult, WebSocketStatus } from '@/hooks/useWebSocket'
import { createClientMessageId } from '@/lib/messageId'
import { scrollBehavior } from '@/lib/motion'
import { useChatStore, isOwnMessage } from '@/stores/chatStore'
import type { ChatMessage as ChatMessageData } from '@/types'
import { useNow } from '@/hooks/useNow'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { ChatMessage } from './ChatMessage'
import { GifButton } from './GifButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

/**
 * Where the panel sits, chosen by the view from its layout:
 * - docked: a column beside the player that the picture shrinks for (desktop)
 * - sheet: over the right of the content, below the header (tablets)
 * - overlay: a drawer over the right edge (theater, phone landscape)
 * - takeover: the whole screen (phones)
 */
export type ChatPanelVariant = 'docked' | 'sheet' | 'overlay' | 'takeover'

const PANEL_CLASSES: Record<ChatPanelVariant, string> = {
  docked: 'relative flex h-full w-80 shrink-0 flex-col border-l border-border bg-card animate-in fade-in-0 duration-200',
  sheet: 'absolute inset-y-0 right-0 z-40 flex w-80 flex-col border-l border-border bg-background shadow-lg animate-in fade-in-0 slide-in-from-right-4 duration-200',
  overlay: 'fixed top-0 right-0 h-full w-80 z-50 bg-background border-l border-border flex flex-col shadow-lg animate-in fade-in-0 slide-in-from-right-4 duration-200',
  // Full-screen on phones: keep the header clear of the status bar and the
  // composer above the home indicator
  takeover: 'fixed inset-0 z-50 bg-background flex flex-col pt-safe pb-safe animate-in fade-in-0 slide-in-from-bottom-4 duration-200',
}

export interface ChatPanelProps {
  onSendMessage: (content: string, clientMessageId: string) => Promise<ChatSendResult> | ChatSendResult
  onSetNickname?: (nickname: string) => void
  // The chat socket's state; sends are held while it isn't connected
  status?: WebSocketStatus
  onReconnect?: () => void
  variant?: ChatPanelVariant
}

// Quick reconnects (including the first connect) finish before the row would flicker in
const RECONNECTING_ROW_DELAY = 2000

// Within this many pixels of the bottom, the reader is following the conversation
const AT_BOTTOM_THRESHOLD = 80

function isNearBottom(viewport: HTMLElement): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < AT_BOTTOM_THRESHOLD
}

// Messages from one sender this close together, on the same day, share one name and one time
const GROUP_GAP_MS = 3 * 60_000

/**
 * Whether a message carries on its sender's group from the one before it. The
 * sender is their account id where the server sends one, so two people who
 * picked the same name never merge; older servers only give the name.
 */
function continuesGroup(previous: ChatMessageData | undefined, message: ChatMessageData): boolean {
  if (!previous || (previous.userId ?? previous.username) !== (message.userId ?? message.username)) return false
  const previousAt = new Date(previous.timestamp)
  const at = new Date(message.timestamp)
  const gap = at.getTime() - previousAt.getTime()
  return gap >= 0 && gap <= GROUP_GAP_MS && at.toDateString() === previousAt.toDateString()
}

/** 'Today', 'Yesterday' or the date, for the local day a message was sent on. */
function dayLabel(sentAt: Date, now: number): string {
  const today = new Date(now)
  if (sentAt.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (sentAt.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return sentAt.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

// A send that failed, kept whole so a retry resends exactly it (a GIF stays a
// GIF) under the same id, which the server recognises instead of reposting
interface SendFailure {
  kind: 'not-sent' | 'unconfirmed'
  content: string
  clientMessageId: string
}

export function ChatPanel({ onSendMessage, onSetNickname, status = 'connected', onReconnect, variant = 'overlay' }: ChatPanelProps) {
  const {
    messages, isOpen, setOpen, nickname, me, readMarker, historyReset, nicknameRejection,
    setNickname, clearNickname, clearNicknameRejection,
  } = useChatStore()
  // One shared tick for every message's relative time
  const now = useNow(30_000)

  const [inputValue, setInputValue] = useState('')
  // Screen readers only: the message bubble is the visible confirmation
  const [sendStatus, setSendStatus] = useState('')
  const [failure, setFailure] = useState<SendFailure | null>(null)
  const [isSending, setIsSending] = useState(false)
  const sending = useRef(false)
  const draftVersion = useRef(0)
  const [nicknameInput, setNicknameInput] = useState('')
  const [isEditingNickname, setIsEditingNickname] = useState(false)
  // The server refused a name (it's another member's sign-in name): the store has
  // already gone back to the old one, so reopen the editor on the refused name
  // with the reason. (Adjusted while rendering, like connectionLost below.)
  const [shownRejection, setShownRejection] = useState<typeof nicknameRejection>(null)
  if (nicknameRejection !== shownRejection) {
    setShownRejection(nicknameRejection)
    if (nicknameRejection) {
      setIsEditingNickname(true)
      setNicknameInput(nicknameRejection.nickname)
    }
  }
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const newDividerRef = useRef<HTMLDivElement>(null)
  const lastScrollTop = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const nicknameInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isConnected = status === 'connected'
  const isReconnecting = status === 'connecting' || status === 'reconnecting'
  const [showReconnecting, setShowReconnecting] = useState(false)
  // Once the connection has been lost, the offline row stays until it's back.
  // The slow retries pass through 'reconnecting' on every attempt, which would
  // otherwise unmount the row each time, shifting the list and hiding Reconnect.
  // (Adjusted while rendering, React's pattern for state that follows a prop.)
  const [connectionLost, setConnectionLost] = useState(status === 'disconnected')
  if (status === 'disconnected' && !connectionLost) setConnectionLost(true)
  else if (status === 'connected' && connectionLost) setConnectionLost(false)
  const showOfflineRow = status === 'disconnected' || (connectionLost && !isConnected)

  // Nobody has to pick a name: chat uses the sign-in name until they choose one
  const showNicknamePrompt = isEditingNickname
  const displayName = nickname ?? me?.username

  // Unread starts at the first message from someone else newer than what was read before opening
  const firstUnreadId = readMarker === null ? undefined : messages.find(
    (msg) => Date.parse(msg.timestamp) > readMarker && !isOwnMessage(msg, { nickname, me })
  )?.messageId

  // The list is on screen: the panel is open and the name editor isn't covering it
  const listVisible = isOpen && !showNicknamePrompt
  // Whether the reader is at the bottom, following new messages as they come.
  // Scrolling up to read back holds the position; new messages then count up
  // in a pill instead of pulling the list down.
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const [scrollRequest, setScrollRequest] = useState(0)
  const lastMessage = messages.at(-1)
  const lastId = lastMessage?.messageId
  const [shownList, setShownList] = useState(false)
  const [seenLastId, setSeenLastId] = useState(lastId)
  // (Adjusted while rendering, like connectionLost above.)
  if (listVisible !== shownList || lastId !== seenLastId) {
    setShownList(listVisible)
    setSeenLastId(lastId)
    if (listVisible && !shownList) {
      // Coming into view: the list opens on the 'New' divider (unread below it) or the bottom
      setNewCount(0)
      setIsAtBottom(!firstUnreadId)
    } else if (listVisible && lastMessage && lastId !== seenLastId) {
      if (isAtBottom || isOwnMessage(lastMessage, { nickname, me })) {
        // Follow it down; your own message always takes you to it
        setIsAtBottom(true)
        setNewCount(0)
        setScrollRequest((n) => n + 1)
      } else {
        const seenIndex = messages.findIndex((msg) => msg.messageId === seenLastId)
        setNewCount((n) => n + (seenIndex === -1 ? 1 : messages.length - 1 - seenIndex))
      }
    }
  }

  // Show the 'New' divider, or the bottom, once the list is on screen
  useEffect(() => {
    if (!listVisible) return
    // The list is freshly mounted at the top
    lastScrollTop.current = viewportRef.current?.scrollTop ?? 0
    // When opening, wait for animation/layout to settle before scrolling
    const timer = setTimeout(() => {
      const divider = newDividerRef.current
      if (divider) divider.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
      else messagesEndRef.current?.scrollIntoView({ behavior: scrollBehavior() })
      // A history that fits (or nearly fits) the panel is already at the bottom.
      // Scrolling to the divider moves nothing there, so no scroll event would say so.
      const viewport = viewportRef.current
      if (viewport && isNearBottom(viewport)) {
        setIsAtBottom(true)
        setNewCount(0)
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [listVisible])

  // Follow new messages down while the reader is at the bottom
  useEffect(() => {
    if (scrollRequest === 0) return
    messagesEndRef.current?.scrollIntoView({ behavior: scrollBehavior() })
  }, [scrollRequest])

  const handleViewportScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const viewport = e.currentTarget
    const atBottom = isNearBottom(viewport)
    const movedUp = viewport.scrollTop < lastScrollTop.current
    lastScrollTop.current = viewport.scrollTop
    if (atBottom) {
      setIsAtBottom(true)
      setNewCount(0)
    } else if (movedUp) {
      // Only scrolling up lets go of the bottom: a smooth scroll on its way down
      // to a new message passes through positions short of it
      setIsAtBottom(false)
    }
  }, [])

  const handleShowNewMessages = useCallback(() => {
    setIsAtBottom(true)
    setNewCount(0)
    messagesEndRef.current?.scrollIntoView({ behavior: scrollBehavior() })
  }, [])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      // Delay focus to allow animation to complete
      const timer = setTimeout(() => {
        if (showNicknamePrompt) {
          nicknameInputRef.current?.focus()
        } else {
          inputRef.current?.focus()
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen, showNicknamePrompt])

  // Closing chat returns focus to where it was when chat opened (usually the
  // chat toggle), instead of dropping it on the page. Recorded before the
  // composer takes focus. A viewer who has since moved focus elsewhere keeps it.
  useLayoutEffect(() => {
    if (!isOpen) return
    const opener = document.activeElement
    const panel = panelRef.current
    return () => {
      const active = document.activeElement
      const focusWasInChat = !active || active === document.body || (panel?.contains(active) ?? false)
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected && focusWasInChat) {
        opener.focus()
      }
    }
  }, [isOpen])

  // The phone takeover covers the whole screen, so it is a modal dialog and
  // Tab stays inside it. The GIF picker's dialog is portalled out and keeps
  // its own trap. Focus return is handled above for every variant.
  const isDialog = variant === 'takeover'
  useFocusTrap(panelRef, { enabled: isOpen && isDialog, restoreFocus: false })

  // Say 'Reconnecting…' only once a reconnect has taken a while
  // (state is only set from the timer and the cleanup, never in the effect body)
  useEffect(() => {
    if (!isReconnecting) return
    const timer = setTimeout(() => setShowReconnecting(true), RECONNECTING_ROW_DELAY)
    return () => {
      clearTimeout(timer)
      setShowReconnecting(false)
    }
  }, [isReconnecting])

  // Note: nickname input is pre-filled in handleEditNickname callback below

  const send = useCallback(async (content: string, clientMessageId: string = createClientMessageId()) => {
    if (sending.current) return 'not-sent' as const
    sending.current = true
    setIsSending(true)
    setSendStatus('Sending…')
    let result: ChatSendResult
    try { result = await onSendMessage(content, clientMessageId) } catch { result = 'unconfirmed' }
    if (result === 'acknowledged') {
      setSendStatus('Message sent')
      setFailure(null)
    } else {
      // The alert row announces the failure
      setSendStatus('')
      setFailure({ kind: result, content, clientMessageId })
    }
    sending.current = false
    setIsSending(false)
    return result
  }, [onSendMessage])

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || sending.current || !isConnected) return
    // Sending the unchanged draft again after a failure is a retry of it
    const clientMessageId = failure?.content === trimmed ? failure.clientMessageId : undefined
    const version = draftVersion.current
    const result = await send(trimmed, clientMessageId)
    if (result === 'acknowledged' && draftVersion.current === version) setInputValue('')
  }, [inputValue, failure, isConnected, send])

  const handleRetry = useCallback(async () => {
    if (!failure || sending.current) return
    // The row goes away when the draft changes, so a failed text send is still the draft
    const isDraft = failure.content === inputValue.trim()
    const version = draftVersion.current
    const result = await send(failure.content, failure.clientMessageId)
    if (result === 'acknowledged' && isDraft && draftVersion.current === version) setInputValue('')
  }, [failure, inputValue, send])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  const handleSaveNickname = useCallback(() => {
    const trimmed = nicknameInput.trim()
    if (!trimmed) return

    clearNicknameRejection()
    setNickname(trimmed)
    onSetNickname?.(trimmed)
    setIsEditingNickname(false)
    setNicknameInput('')
  }, [nicknameInput, setNickname, onSetNickname, clearNicknameRejection])

  const handleUseSignInName = useCallback(() => {
    // An empty set_nickname makes the server post under the sign-in name again
    clearNicknameRejection()
    clearNickname()
    onSetNickname?.('')
    setIsEditingNickname(false)
    setNicknameInput('')
  }, [clearNickname, onSetNickname, clearNicknameRejection])

  const handleNicknameKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSaveNickname()
      }
    },
    [handleSaveNickname]
  )

  // Leave the editor without changing the name
  const handleCancelNickname = useCallback(() => {
    clearNicknameRejection()
    setIsEditingNickname(false)
    setNicknameInput('')
  }, [clearNicknameRejection])

  const handleEditorKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Escape') return
      // Escape backs out of the editor only; it must not also close the chat or leave theater
      e.preventDefault()
      e.stopPropagation()
      handleCancelNickname()
    },
    [handleCancelNickname]
  )

  const handleEditNickname = useCallback(() => {
    if (nickname) {
      setNicknameInput(nickname)
    }
    setIsEditingNickname(true)
  }, [nickname])

  if (!isOpen) return null

  // Where each sender's group begins. The 'New' divider ends a group, so the
  // first unread message always shows who sent it
  const startsGroup = messages.map(
    (msg, index) => msg.messageId === firstUnreadId || !continuesGroup(messages[index - 1], msg)
  )
  // A day separator goes before the first message of each local day
  const daySeparators = messages.map((msg, index) => {
    const sentAt = new Date(msg.timestamp)
    if (Number.isNaN(sentAt.getTime())) return null
    const previous = messages[index - 1]
    if (previous && new Date(previous.timestamp).toDateString() === sentAt.toDateString()) return null
    return dayLabel(sentAt, now)
  })

  // Docked and sheet sit in the page beside the header's controls, so they're
  // a complementary landmark rather than a layer over everything; the phone
  // takeover is a modal dialog (see isDialog). The role is an attribute on one
  // element type: swapping the element when theater switches the variant
  // would remount the list and drop its scroll and focus
  const isLandmark = variant === 'docked' || variant === 'sheet'

  return (
    <div
      ref={panelRef}
      id="chat-panel"
      role={isLandmark ? 'complementary' : isDialog ? 'dialog' : undefined}
      aria-label={isLandmark ? 'Chat' : undefined}
      aria-modal={isDialog ? true : undefined}
      aria-labelledby={isDialog ? 'chat-panel-title' : undefined}
      className={PANEL_CLASSES[variant]}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="chat-panel-title" className="text-lg font-semibold">Chat</h2>
          {me && !isEditingNickname && (
            <>
              <span className="truncate text-sm text-muted-foreground">Chatting as {displayName}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleEditNickname}
                aria-label="Edit nickname"
                className="h-6 w-6 shrink-0"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          aria-label="Close chat"
          className="h-8 w-8"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* One row for both states, so switching between them never moves the list */}
      {(showOfflineRow || (showReconnecting && isReconnecting)) && (
        <div role="status" className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-4 text-sm text-muted-foreground">
          {showOfflineRow ? (
            <>
              {/* The copy holds steady through retry attempts; only the icon says one is under way */}
              {isReconnecting
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
                : <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span className="flex-1">Chat is offline</span>
              {onReconnect && (
                <Button variant="ghost" size="sm" className="h-7" onClick={onReconnect}>
                  Reconnect
                </Button>
              )}
            </>
          ) : (
            <>
              <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
              Reconnecting…
            </>
          )}
        </div>
      )}

      {showNicknamePrompt ? (
        /* Display name editor */
        <div className="flex-1 flex flex-col items-center justify-center p-6" onKeyDown={handleEditorKeyDown}>
          <h3 className="text-muted-foreground text-sm mb-4">Change display name</h3>
          <div className="flex gap-2 w-full max-w-xs">
            <Input
              ref={nicknameInputRef}
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onKeyDown={handleNicknameKeyDown}
              placeholder="Display name"
              className="flex-1"
              maxLength={30}
              aria-invalid={nicknameRejection ? true : undefined}
              aria-describedby={nicknameRejection ? 'chat-nickname-error' : undefined}
            />
            <Button
              onClick={handleSaveNickname}
              disabled={!nicknameInput.trim()}
            >
              Save
            </Button>
          </div>
          {nicknameRejection && (
            <p id="chat-nickname-error" role="alert" className="mt-2 w-full max-w-xs text-sm text-destructive">
              “{nicknameRejection.nickname}” is another member's sign-in name. Choose a different name.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancelNickname}>
              Cancel
            </Button>
            {me && (
              <Button variant="link" size="sm" onClick={handleUseSignInName}>
                Use my sign-in name
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <ScrollArea className="flex-1" viewportRef={viewportRef} onViewportScroll={handleViewportScroll}>
              <div className="py-2">
                {historyReset && (
                  <p className="px-4 py-2 text-center text-xs text-muted-foreground">
                    Chat history was cleared (server restart or an admin cleared it)
                  </p>
                )}
                {messages.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-8">
                    No messages yet. Say hello!
                  </p>
                ) : (
                  messages.map((msg, index) => (
                    <Fragment key={msg.messageId}>
                      {daySeparators[index] && (
                        <div
                          role="separator"
                          aria-label={daySeparators[index]}
                          className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground"
                        >
                          <span className="h-px flex-1 bg-border" aria-hidden="true" />
                          {daySeparators[index]}
                          <span className="h-px flex-1 bg-border" aria-hidden="true" />
                        </div>
                      )}
                      {msg.messageId === firstUnreadId && (
                        <div
                          ref={newDividerRef}
                          role="separator"
                          aria-label="New messages"
                          className="flex items-center gap-2 px-4 py-1 text-xs font-semibold text-primary"
                        >
                          <span className="h-px flex-1 bg-primary/50" aria-hidden="true" />
                          New
                          <span className="h-px flex-1 bg-primary/50" aria-hidden="true" />
                        </div>
                      )}
                      <ChatMessage
                        message={msg}
                        isOwn={isOwnMessage(msg, { nickname, me })}
                        now={now}
                        isFirstInGroup={startsGroup[index]}
                        isLastInGroup={startsGroup[index + 1] ?? true}
                      />
                    </Fragment>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
            {newCount > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleShowNewMessages}
                className="absolute bottom-2 left-1/2 h-7 -translate-x-1/2 rounded-full shadow-md"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                {newCount === 1 ? '1 new message' : `${newCount} new messages`}
              </Button>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border p-3">
            <p role="status" className="sr-only">{sendStatus}</p>
            {failure && (
              <div role="alert" className="mb-2 flex h-8 items-center gap-2 text-sm">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  {failure.kind === 'not-sent'
                    ? "Not sent. You're offline or reconnecting."
                    : "Couldn't confirm it was sent."}
                </span>
                <Button variant="ghost" size="sm" className="h-7" onClick={handleRetry} disabled={isSending || !isConnected}>
                  {failure.kind === 'not-sent' ? 'Retry' : 'Send again'}
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => { draftVersion.current += 1; setFailure(null); setInputValue(e.target.value) }}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1"
                maxLength={500}
              />
              <GifButton onSelect={async (url) => (await send(url)) === 'acknowledged'} disabled={isSending || !isConnected} />
              <Button
                onClick={handleSend}
                disabled={!inputValue.trim() || isSending || !isConnected}
                size="icon"
                aria-label="Send message"
              >
                {isSending
                  ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                  : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
