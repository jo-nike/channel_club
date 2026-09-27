import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/stores/authStore'
import type { ChatSendResult } from '@/hooks/useWebSocket'
import type { ChatMessage } from '@/types'

// Nicknames are stored per signed-in user, so a shared browser or TV doesn't
// hand one person's chat name to the next person who signs in
const LEGACY_NICKNAME_STORAGE_KEY = 'chat_nickname'
const nicknameStorageKey = (username: string) => `chat_nickname:${username}`
const MAX_NICKNAME_LENGTH = 30
// When this user last had the chat in front of them (server time, ms), per user like the nickname
const lastReadStorageKey = (username: string) => `chat_last_read:${username}`

export interface ChatIdentity {
  username: string
  // Stable id the server stamps on this account's messages (absent from older servers)
  userId?: string
}

// A nickname the server refused because it is another connected member's sign-in name.
// A new object per refusal, so refusing the same name twice still registers
export interface NicknameRejection {
  nickname: string
}

/** Posts a chat message over the view's socket (useWebSocket's sendChatMessage). */
export type ChatSender = (content: string, clientMessageId?: string) => Promise<ChatSendResult>

/** Posts a live TV suggestion card over the view's socket (useWebSocket's sendSuggest). */
export type ChatSuggester = (channelId: string, clientMessageId?: string) => Promise<ChatSendResult>

interface ChatState {
  messages: ChatMessage[]
  isOpen: boolean
  unreadCount: number
  nickname: string | null
  // Who the server says this socket is signed in as (from connection_ack)
  me: ChatIdentity | null
  // The nickname to go back to if the server refuses the one just set
  revertNickname: string | null
  // The last nickname the server refused, until the person saves another, cancels or goes back to the sign-in name
  nicknameRejection: NicknameRejection | null
  // Newest message timestamp this user has seen (ms); null until the first history
  lastReadAt: number | null
  // While open: lastReadAt from before opening, if anything unread was newer
  readMarker: number | null
  // The server sent an empty history over a non-empty list (restart or cleared)
  historyReset: boolean
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
  rejectNickname: (nickname: string) => void
  clearNicknameRejection: () => void
  // The view that owns the socket registers how to send, so in-player
  // features can post without the sender threaded down to them as a prop.
  // Returns the unregister, which leaves a newer registration alone.
  registerSender: (sender: ChatSender) => () => void
  // Sends through the registered sender; 'not-sent' while there is none
  sendMessage: (content: string, clientMessageId?: string) => Promise<ChatSendResult>
  // The same for suggestion cards, so a suggestion made anywhere (the NHL
  // scores, the Live TV switcher) is the one card an admin can put on
  registerSuggester: (suggester: ChatSuggester) => () => void
  // Suggests through the registered suggester; 'not-sent' while there is none
  suggestChannel: (channelId: string, clientMessageId?: string) => Promise<ChatSendResult>
}

const MAX_MESSAGES = 100

// Outside the state: a function nobody renders, so registering it re-renders nothing
let registeredSender: ChatSender | null = null
let registeredSuggester: ChatSuggester | null = null

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

/** This user's stored lastReadAt, or null if none is stored. */
const loadLastRead = (username: string): number | null => {
  const stored = localStorage.getItem(lastReadStorageKey(username))
  const value = stored === null ? NaN : Number(stored)
  return Number.isFinite(value) ? value : null
}

/** Remember lastReadAt for this user; without a known identity it stays in memory. */
const saveLastRead = (me: ChatIdentity | null, lastReadAt: number | null) => {
  if (me && lastReadAt !== null) localStorage.setItem(lastReadStorageKey(me.username), String(lastReadAt))
}

/** The later of two read times; read state never moves backwards. */
const laterOf = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b)

/** Newest server timestamp in a list (ms), or null for none. Never the client clock. */
const newestTimestamp = (messages: ChatMessage[]): number | null =>
  messages.reduce<number | null>((newest, m) => {
    const at = Date.parse(m.timestamp)
    return Number.isNaN(at) ? newest : laterOf(newest, at)
  }, null)

/** Store this user's nickname, or remove it when there is none; without a known identity there is no key. */
const saveNickname = (me: ChatIdentity | null, nickname: string | null) => {
  if (!me) return
  if (nickname) localStorage.setItem(nicknameStorageKey(me.username), nickname)
  else localStorage.removeItem(nicknameStorageKey(me.username))
}

/** A line the server posts about a shared event (someone changing Live), not a member's message. */
export const isSystemMessage = (message: Pick<ChatMessage, 'kind'>): boolean => message.kind === 'system'

/**
 * Whether a message was sent by this user. The server stamps each message with
 * the sender's userId, so renaming yourself keeps your earlier messages yours
 * and someone else picking your name doesn't make theirs yours. Without ids
 * (older servers, or before connection_ack), its name matches the nickname, or
 * the sign-in name when no nickname is set (the server posts under it then).
 * System lines are nobody's, whatever name they carry.
 */
export const isOwnMessage = (
  message: Pick<ChatMessage, 'username' | 'userId' | 'kind'>,
  state: Pick<ChatState, 'nickname' | 'me'>
): boolean => {
  if (isSystemMessage(message)) return false
  if (message.userId && state.me?.userId) return message.userId === state.me.userId
  const ownName = state.nickname ?? state.me?.username
  return ownName ? message.username === ownName : false
}

/**
 * Whether a message counts towards unread: someone else's message. System
 * lines don't; they report a change on Live rather than anyone talking.
 */
export const countsAsUnread = (message: ChatMessage, state: Pick<ChatState, 'nickname' | 'me'>): boolean =>
  !isSystemMessage(message) && !isOwnMessage(message, state)

/** Other people's messages newer than a read time. */
const countUnreadSince = (
  messages: ChatMessage[],
  since: number,
  state: Pick<ChatState, 'nickname' | 'me'>
): number => messages.filter((m) => Date.parse(m.timestamp) > since && countsAsUnread(m, state)).length

/**
 * Open or close the panel. Opening marks where unread starts (for the 'New'
 * divider) and reads everything; closing reads everything and drops the mark.
 */
const openState = (state: ChatState, open: boolean): Partial<ChatState> => {
  if (open === state.isOpen) return { isOpen: open, unreadCount: open ? 0 : state.unreadCount }
  const lastReadAt = laterOf(state.lastReadAt, newestTimestamp(state.messages))
  saveLastRead(state.me, lastReadAt)
  if (!open) return { isOpen: false, lastReadAt, readMarker: null }
  const hasUnread = state.lastReadAt !== null && countUnreadSince(state.messages, state.lastReadAt, state) > 0
  return { isOpen: true, unreadCount: 0, lastReadAt, readMarker: hasUnread ? state.lastReadAt : null }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  unreadCount: 0,
  // Unknown until connection_ack says who we are; setIdentity loads it
  nickname: null,
  me: null,
  revertNickname: null,
  nicknameRejection: null,
  lastReadAt: null,
  readMarker: null,
  historyReset: false,

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
      // Your own messages (say, sent from another tab or device) and system lines
      // are never unread, matching the history recount, so a reconnect doesn't drop the badge
      if (!state.isOpen) {
        return { messages: newMessages, unreadCount: state.unreadCount + (countsAsUnread(message, state) ? 1 : 0) }
      }
      // Seen as it arrives
      const lastReadAt = laterOf(state.lastReadAt, newestTimestamp([message]))
      saveLastRead(state.me, lastReadAt)
      return { messages: newMessages, unreadCount: 0, lastReadAt }
    })
  },

  setMessages: (messages) => {
    logger.debug('ChatStore', `Setting ${messages.length} messages (history)`)
    set((state) => {
      const history = messages.slice(-MAX_MESSAGES)
      // History lives in server memory: an empty one after messages means it was wiped
      const historyReset = history.length === 0 ? state.historyReset || state.messages.length > 0 : false
      if (state.lastReadAt === null || state.isOpen) {
        // A first load counts nothing (no '9+' for newcomers); an open panel has read it all.
        // An empty first history still counts as seen: read up to the epoch, so anything after it is unread
        const lastReadAt = laterOf(state.lastReadAt, newestTimestamp(history)) ?? 0
        saveLastRead(state.me, lastReadAt)
        return { messages: history, lastReadAt, historyReset }
      }
      // Recount rather than add, so messages addMessage already counted aren't counted twice
      return { messages: history, unreadCount: countUnreadSince(history, state.lastReadAt, state), historyReset }
    })
  },

  toggleOpen: () => {
    const isOpening = !get().isOpen
    logger.debug('ChatStore', `Toggle chat: ${isOpening ? 'open' : 'close'}`)
    set((state) => openState(state, isOpening))
  },

  setOpen: (open) => {
    logger.debug('ChatStore', `Set chat open: ${open}`)
    set((state) => openState(state, open))
  },

  clearUnread: () => set({ unreadCount: 0 }),

  clearMessages: () => {
    logger.debug('ChatStore', 'Clearing messages')
    set({ messages: [], unreadCount: 0, historyReset: false })
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
      // Applied at once; the server only answers if it refuses the name
      set((state) => ({ nickname: trimmed, revertNickname: state.nickname }))
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
    set((state) => {
      // A reconnect as the same user keeps its read state; anyone else gets their own
      const sameUser = state.me?.username === me.username
      const stored = loadLastRead(me.username)
      return {
        me: { username: me.username, userId: me.userId },
        nickname,
        // A new socket starts on the sign-in name, so a refused stored nickname falls back to it
        revertNickname: null,
        nicknameRejection: sameUser ? state.nicknameRejection : null,
        lastReadAt: sameUser ? laterOf(state.lastReadAt, stored) : stored,
        readMarker: sameUser ? state.readMarker : null,
      }
    })
  },

  resetIdentity: () => {
    logger.debug('ChatStore', 'Identity reset')
    set({ me: null, nickname: null, revertNickname: null, nicknameRejection: null, lastReadAt: null, readMarker: null })
  },

  rejectNickname: (refused) => {
    const state = get()
    // Already moved on to another name: the server kept that one, nothing to undo
    if (state.nickname !== refused) {
      logger.debug('ChatStore', `Ignoring refusal of a nickname no longer in use: ${refused}`)
      return
    }
    logger.debug('ChatStore', `Nickname refused: ${refused}`)
    // Go back to the name the server still uses, here and in storage
    saveNickname(state.me, state.revertNickname)
    set({ nickname: state.revertNickname, revertNickname: null, nicknameRejection: { nickname: refused } })
  },

  clearNicknameRejection: () => set({ nicknameRejection: null }),

  registerSender: (sender) => {
    registeredSender = sender
    return () => {
      if (registeredSender === sender) registeredSender = null
    }
  },

  sendMessage: async (content, clientMessageId) => {
    const sender = registeredSender
    if (!sender) {
      logger.debug('ChatStore', 'No chat sender registered; message not sent')
      return 'not-sent'
    }
    // A throw is a send whose fate is unknown, as the panel treats it
    try {
      return await sender(content, clientMessageId)
    } catch {
      return 'unconfirmed'
    }
  },

  registerSuggester: (suggester) => {
    registeredSuggester = suggester
    return () => {
      if (registeredSuggester === suggester) registeredSuggester = null
    }
  },

  suggestChannel: async (channelId, clientMessageId) => {
    const suggester = registeredSuggester
    if (!suggester) {
      logger.debug('ChatStore', 'No chat suggester registered; suggestion not sent')
      return 'not-sent'
    }
    try {
      return await suggester(channelId, clientMessageId)
    } catch {
      return 'unconfirmed'
    }
  },
}))

// Signed out: forget who chat thinks we are, so the next person to sign in on
// this browser starts clean. This can't live in useWebSocket: the view that
// owns the socket unmounts in the same update that clears the token, so an
// effect there never sees the token go away.
useAuthStore.subscribe((state, previous) => {
  if (previous.token && !state.token) useChatStore.getState().resetIdentity()
})
