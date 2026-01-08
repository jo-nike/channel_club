import { useRef, useEffect, useState, useCallback, type KeyboardEvent } from 'react'
import { X, Send, Pencil } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { ChatMessage } from './ChatMessage'
import { GifButton } from './GifButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

export interface ChatPanelProps {
  onSendMessage: (content: string) => void
  currentUsername?: string
  onSetNickname?: (nickname: string) => void
}

export function ChatPanel({ onSendMessage, onSetNickname }: ChatPanelProps) {
  const { messages, isOpen, setOpen, nickname, setNickname } = useChatStore()
  const breakpoint = useBreakpoint()
  const isMobile = breakpoint === 'mobile'

  const [inputValue, setInputValue] = useState('')
  const [nicknameInput, setNicknameInput] = useState('')
  const [isEditingNickname, setIsEditingNickname] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nicknameInputRef = useRef<HTMLInputElement>(null)

  // Show nickname prompt if no nickname set or editing
  const showNicknamePrompt = !nickname || isEditingNickname

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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

  // Pre-fill nickname input when editing
  useEffect(() => {
    if (isEditingNickname && nickname) {
      setNicknameInput(nickname)
    }
  }, [isEditingNickname, nickname])

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim()
    if (!trimmed) return

    onSendMessage(trimmed)
    setInputValue('')
  }, [inputValue, onSendMessage])

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

  const handleNicknameKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSaveNickname()
      }
    },
    [handleSaveNickname]
  )

  const handleEditNickname = useCallback(() => {
    setIsEditingNickname(true)
  }, [])

  if (!isOpen) return null

  // Panel styles based on viewport
  const panelClasses = isMobile
    ? 'fixed inset-0 z-50 bg-background flex flex-col'
    : 'fixed top-0 right-0 h-full w-80 z-50 bg-background border-l border-border flex flex-col shadow-lg'

  const animationClasses = isMobile
    ? 'animate-in fade-in-0 slide-in-from-bottom-4 duration-200'
    : 'animate-in fade-in-0 slide-in-from-right-4 duration-200'

  return (
    <div className={`${panelClasses} ${animationClasses}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Chat</h2>
          {nickname && !isEditingNickname && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleEditNickname}
              aria-label="Edit nickname"
              className="h-6 w-6"
            >
              <Pencil className="h-3 w-3" />
            </Button>
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

      {showNicknamePrompt ? (
        /* Nickname Prompt */
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <p className="text-muted-foreground text-sm mb-4">Choose a display name</p>
          <div className="flex gap-2 w-full max-w-xs">
            <Input
              ref={nicknameInputRef}
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onKeyDown={handleNicknameKeyDown}
              placeholder="Enter display name..."
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
        </div>
      ) : (
        <>
          {/* Messages */}
          <ScrollArea className="flex-1">
            <div className="py-2">
              {messages.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">
                  No messages yet. Say hello!
                </p>
              ) : (
                messages.map((msg) => (
                  <ChatMessage
                    key={msg.messageId}
                    message={msg}
                    isOwn={nickname ? msg.username === nickname : false}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1"
                maxLength={500}
              />
              <GifButton onSelect={onSendMessage} disabled={!nickname} />
              <Button
                onClick={handleSend}
                disabled={!inputValue.trim()}
                size="icon"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
