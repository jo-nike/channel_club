import { create } from 'zustand'
import { logger } from '@/lib/logger'
import type { ChatMessage } from '@/types'

const NICKNAME_STORAGE_KEY = 'chat_nickname'
const MAX_NICKNAME_LENGTH = 30

interface ChatState {
  messages: ChatMessage[]
  isOpen: boolean
  unreadCount: number
  nickname: string | null
  addMessage: (message: ChatMessage) => void
  setMessages: (messages: ChatMessage[]) => void
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  clearUnread: () => void
  clearMessages: () => void
  setNickname: (nickname: string) => void
  clearNickname: () => void
}

const MAX_MESSAGES = 100

// Load nickname from localStorage on init
const getInitialNickname = (): string | null => {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(NICKNAME_STORAGE_KEY)
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  unreadCount: 0,
  nickname: getInitialNickname(),

  addMessage: (message) => {
    // Deduplicate by messageId (prevents double-adds from React StrictMode)
    const existing = get().messages.find((m) => m.messageId === message.messageId)
    if (existing) {
      logger.debug('ChatStore', `Duplicate message ignored: ${message.messageId}`)
      return
    }
    logger.debug('ChatStore', `New message from ${message.username}`)
    set((state) => {
      const newMessages = [...state.messages, message].slice(-MAX_MESSAGES)
      return {
        messages: newMessages,
        unreadCount: state.isOpen ? 0 : state.unreadCount + 1,
      }
    })
  },

  setMessages: (messages) => {
    logger.debug('ChatStore', `Setting ${messages.length} messages (history)`)
    set({ messages: messages.slice(-MAX_MESSAGES) })
  },

  toggleOpen: () => {
    const isOpening = !get().isOpen
    logger.debug('ChatStore', `Toggle chat: ${isOpening ? 'open' : 'close'}`)
    set({
      isOpen: isOpening,
      unreadCount: isOpening ? 0 : get().unreadCount,
    })
  },

  setOpen: (open) => {
    logger.debug('ChatStore', `Set chat open: ${open}`)
    set({
      isOpen: open,
      unreadCount: open ? 0 : get().unreadCount,
    })
  },

  clearUnread: () => set({ unreadCount: 0 }),

  clearMessages: () => {
    logger.debug('ChatStore', 'Clearing messages')
    set({ messages: [], unreadCount: 0 })
  },

  setNickname: (nickname: string) => {
    const trimmed = nickname.trim().slice(0, MAX_NICKNAME_LENGTH)
    if (!trimmed) {
      // Empty nickname - clear it
      localStorage.removeItem(NICKNAME_STORAGE_KEY)
      set({ nickname: null })
      logger.debug('ChatStore', 'Nickname cleared')
    } else {
      localStorage.setItem(NICKNAME_STORAGE_KEY, trimmed)
      set({ nickname: trimmed })
      logger.debug('ChatStore', `Nickname set to: ${trimmed}`)
    }
  },

  clearNickname: () => {
    localStorage.removeItem(NICKNAME_STORAGE_KEY)
    set({ nickname: null })
    logger.debug('ChatStore', 'Nickname cleared')
  },
}))
