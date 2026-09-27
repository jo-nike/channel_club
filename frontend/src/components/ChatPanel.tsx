import { Fragment, useRef, useEffect, useState, useCallback, type KeyboardEvent } from 'react'
import { X, Send, Pencil, Loader2, AlertCircle, WifiOff } from 'lucide-react'
import type { ChatSendResult, WebSocketStatus } from '@/hooks/useWebSocket'
import { createClientMessageId } from '@/lib/messageId'
import { useChatStore, isOwnMessage } from '@/stores/chatStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { ChatMessage } from './ChatMessage'
import { GifButton } from './GifButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

export interface ChatPanelProps {
  onSendMessage: (content: string, clientMessageId: string) => Promise<ChatSendResult> | ChatSendResult
  onSetNickname?: (nickname: string) => void
  // The chat socket's state; sends are held while it isn't connected
  status?: WebSocketStatus
  onReconnect?: () => void
}

// Quick reconnects (including the first connect) finish before the row would flicker in
const RECONNECTING_ROW_DELAY = 2000

// A send that failed, kept whole so a retry resends exactly it (a GIF stays a
// GIF) under the same id, which the server recognises instead of reposting
interface SendFailure {
  kind: 'not-sent' | 'unconfirmed'
  content: string
  clientMessageId: string
}

export function ChatPanel({ onSendMessage, onSetNickname, status = 'connected', onReconnect }: ChatPanelProps) {
  const { messages, isOpen, setOpen, nickname, me, readMarker, historyReset, setNickname, clearNickname } = useChatStore()
  const breakpoint = useBreakpoint()
  const isMobile = breakpoint === 'mobile'

  const [inputValue, setInputValue] = useState('')
  // Screen readers only: the message bubble is the visible confirmation
  const [sendStatus, setSendStatus] = useState('')
  const [failure, setFailure] = useState<SendFailure | null>(null)
  const [isSending, setIsSending] = useState(false)
  const sending = useRef(false)
  const draftVersion = useRef(0)
  const [nicknameInput, setNicknameInput] = useState('')
  const [isEditingNickname, setIsEditingNickname] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nicknameInputRef = useRef<HTMLInputElement>(null)
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

  // Auto-scroll to bottom when new messages arrive or panel opens
  useEffect(() => {
    if (isOpen) {
      // When opening, wait for animation/layout to settle before scrolling
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [messages, isOpen])

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

    setNickname(trimmed)
    onSetNickname?.(trimmed)
    setIsEditingNickname(false)
    setNicknameInput('')
  }, [nicknameInput, setNickname, onSetNickname])

  const handleUseSignInName = useCallback(() => {
    // An empty set_nickname makes the server post under the sign-in name again
    clearNickname()
    onSetNickname?.('')
    setIsEditingNickname(false)
    setNicknameInput('')
  }, [clearNickname, onSetNickname])

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
    setIsEditingNickname(false)
    setNicknameInput('')
  }, [])

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

  // Unread starts at the first message from someone else newer than what was read before opening
  const firstUnreadId = readMarker === null ? undefined : messages.find(
    (msg) => Date.parse(msg.timestamp) > readMarker && !isOwnMessage(msg, { nickname, me })
  )?.messageId

  // Panel styles based on viewport
  // Full-screen on phones: keep the header clear of the status bar and the
  // composer above the home indicator
  const panelClasses = isMobile
    ? 'fixed inset-0 z-50 bg-background flex flex-col pt-safe pb-safe'
    : 'fixed top-0 right-0 h-full w-80 z-50 bg-background border-l border-border flex flex-col shadow-lg'

  const animationClasses = isMobile
    ? 'animate-in fade-in-0 slide-in-from-bottom-4 duration-200'
    : 'animate-in fade-in-0 slide-in-from-right-4 duration-200'

  return (
    <div className={`${panelClasses} ${animationClasses}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-lg font-semibold">Chat</h2>
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
            />
            <Button
              onClick={handleSaveNickname}
              disabled={!nicknameInput.trim()}
            >
              Save
            </Button>
          </div>
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
          <ScrollArea className="flex-1">
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
                messages.map((msg) => (
                  <Fragment key={msg.messageId}>
                    {msg.messageId === firstUnreadId && (
                      <div
                        role="separator"
                        aria-label="New messages"
                        className="flex items-center gap-2 px-4 py-1 text-xs font-semibold text-primary"
                      >
                        <span className="h-px flex-1 bg-primary/50" aria-hidden="true" />
                        New
                        <span className="h-px flex-1 bg-primary/50" aria-hidden="true" />
                      </div>
                    )}
                    <ChatMessage message={msg} isOwn={isOwnMessage(msg, { nickname, me })} />
                  </Fragment>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

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
