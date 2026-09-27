import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/stores/authStore'
import type { ChatMessage } from '@/types'

// Nicknames are stored per signed-in user, so a shared browser or TV doesn't
// hand one person's chat name to the next person who signs in
const LEGACY_NICKNAME_STORAGE_KEY = 'chat_nickname'
const nicknameStorageKey = (username: string) => `chat_nickname:${username}`
const MAX_NICKNAME_LENGTH = 30

export interface ChatIdentity {
  username: string
}

interface ChatState {
  messages: ChatMessage[]
  isOpen: boolean
  unreadCount: number
  nickname: string | null
  // Who the server says this socket is signed in as (from connection_ack)
  me: ChatIdentity | null
  addMessage: (message: ChatMessage) => void
  setMessages: (messages: ChatMessage[]) => void
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  clearUnread: () => void
  clearMessages: () => void
  setNickname: (nickname: string) => void
  clearNickname: () => void
  setIdentity: (me: ChatIdentity) => void
  resetIdentity: () => void
}

const MAX_MESSAGES = 100

/**
 * Load a user's stored nickname. The first user to sign in after the switch
 * to per-user keys adopts the old shared 'chat_nickname' once; it is then
 * deleted so nobody else inherits it.
 */
const loadNickname = (username: string): string | null => {
  const key = nicknameStorageKey(username)
  const legacy = localStorage.getItem(LEGACY_NICKNAME_STORAGE_KEY)
  if (legacy !== null) {
    localStorage.removeItem(LEGACY_NICKNAME_STORAGE_KEY)
    if (localStorage.getItem(key) === null && legacy) {
      localStorage.setItem(key, legacy)
      logger.debug('ChatStore', `Adopted legacy nickname for ${username}`)
    }
  }
  return localStorage.getItem(key)
}

/**
 * Whether a message was sent by this user: its name matches the nickname, or
 * the sign-in name when no nickname is set (the server posts under it then).
 */
export const isOwnMessage = (
  message: Pick<ChatMessage, 'username'>,
  state: Pick<ChatState, 'nickname' | 'me'>
): boolean => {
  const ownName = state.nickname ?? state.me?.username
  return ownName ? message.username === ownName : false
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  unreadCount: 0,
  // Unknown until connection_ack says who we are; setIdentity loads it
  nickname: null,
  me: null,

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
    const me = get().me
    if (!trimmed) {
      // Empty nickname - clear it
      if (me) localStorage.removeItem(nicknameStorageKey(me.username))
      set({ nickname: null })
      logger.debug('ChatStore', 'Nickname cleared')
    } else {
      // Without a known identity there is no key to store it under; keep it in memory
      if (me) localStorage.setItem(nicknameStorageKey(me.username), trimmed)
      set({ nickname: trimmed })
      logger.debug('ChatStore', `Nickname set to: ${trimmed}`)
    }
  },

  clearNickname: () => {
    const me = get().me
    if (me) localStorage.removeItem(nicknameStorageKey(me.username))
    set({ nickname: null })
    logger.debug('ChatStore', 'Nickname cleared')
  },

  setIdentity: (me) => {
    // Replace, never merge: the previous user's nickname must not carry over
    const nickname = loadNickname(me.username)
    logger.debug('ChatStore', `Chatting as ${me.username}${nickname ? ` (nickname ${nickname})` : ''}`)
    set({ me: { username: me.username }, nickname })
  },

  resetIdentity: () => {
    logger.debug('ChatStore', 'Identity reset')
    set({ me: null, nickname: null })
  },
}))

// Signed out: forget who chat thinks we are, so the next person to sign in on
// this browser starts clean. This can't live in useWebSocket: the view that
// owns the socket unmounts in the same update that clears the token, so an
// effect there never sees the token go away.
useAuthStore.subscribe((state, previous) => {
  if (previous.token && !state.token) useChatStore.getState().resetIdentity()
})
