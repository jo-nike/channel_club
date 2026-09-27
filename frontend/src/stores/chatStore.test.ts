import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, isOwnMessage } from './chatStore'
import { useAuthStore } from './authStore'
import type { ChatMessage } from '@/types'

const createMessage = (id: string, username: string = 'user'): ChatMessage => ({
  messageId: id,
  username,
  content: `Message ${id}`,
  timestamp: new Date().toISOString(),
})

describe('useChatStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useChatStore.setState({
      messages: [],
      isOpen: false,
      unreadCount: 0,
      nickname: null,
      me: null,
    })
  })

  describe('addMessage', () => {
    it('adds a message to the store', () => {
      const message = createMessage('1')
      useChatStore.getState().addMessage(message)
      expect(useChatStore.getState().messages).toHaveLength(1)
      expect(useChatStore.getState().messages[0]).toEqual(message)
    })

    it('increments unread count when chat is closed', () => {
      useChatStore.setState({ isOpen: false })
      useChatStore.getState().addMessage(createMessage('1'))
      expect(useChatStore.getState().unreadCount).toBe(1)
      useChatStore.getState().addMessage(createMessage('2'))
      expect(useChatStore.getState().unreadCount).toBe(2)
    })

    it('does not increment unread count when chat is open', () => {
      useChatStore.setState({ isOpen: true })
      useChatStore.getState().addMessage(createMessage('1'))
      expect(useChatStore.getState().unreadCount).toBe(0)
    })

    it('limits messages to 100', () => {
      const messages = Array.from({ length: 150 }, (_, i) =>
        createMessage(String(i))
      )
      messages.forEach((m) => useChatStore.getState().addMessage(m))
      expect(useChatStore.getState().messages).toHaveLength(100)
      expect(useChatStore.getState().messages[0].messageId).toBe('50')
      expect(useChatStore.getState().messages[99].messageId).toBe('149')
    })

    it('ignores duplicate messages by messageId', () => {
      const message = createMessage('1')
      useChatStore.getState().addMessage(message)
      useChatStore.getState().addMessage(message) // Same message again
      useChatStore.getState().addMessage({ ...message }) // Copy with same ID
      expect(useChatStore.getState().messages).toHaveLength(1)
    })

    it('does not increment unread for duplicate messages', () => {
      useChatStore.setState({ isOpen: false })
      const message = createMessage('1')
      useChatStore.getState().addMessage(message)
      expect(useChatStore.getState().unreadCount).toBe(1)
      useChatStore.getState().addMessage(message) // Duplicate
      expect(useChatStore.getState().unreadCount).toBe(1) // Still 1
    })
  })

  describe('setMessages', () => {
    it('sets messages (for history)', () => {
      const messages = [createMessage('1'), createMessage('2')]
      useChatStore.getState().setMessages(messages)
      expect(useChatStore.getState().messages).toHaveLength(2)
    })

    it('limits history to 100 messages', () => {
      const messages = Array.from({ length: 150 }, (_, i) =>
        createMessage(String(i))
      )
      useChatStore.getState().setMessages(messages)
      expect(useChatStore.getState().messages).toHaveLength(100)
    })
  })

  describe('toggleOpen', () => {
    it('toggles isOpen state', () => {
      expect(useChatStore.getState().isOpen).toBe(false)
      useChatStore.getState().toggleOpen()
      expect(useChatStore.getState().isOpen).toBe(true)
      useChatStore.getState().toggleOpen()
      expect(useChatStore.getState().isOpen).toBe(false)
    })

    it('clears unread count when opening', () => {
      useChatStore.setState({ isOpen: false, unreadCount: 5 })
      useChatStore.getState().toggleOpen()
      expect(useChatStore.getState().unreadCount).toBe(0)
    })

    it('preserves unread count when closing', () => {
      useChatStore.setState({ isOpen: true, unreadCount: 5 })
      useChatStore.getState().toggleOpen()
      expect(useChatStore.getState().unreadCount).toBe(5)
    })
  })

  describe('setOpen', () => {
    it('sets isOpen to true', () => {
      useChatStore.getState().setOpen(true)
      expect(useChatStore.getState().isOpen).toBe(true)
    })

    it('clears unread count when opening', () => {
      useChatStore.setState({ unreadCount: 5 })
      useChatStore.getState().setOpen(true)
      expect(useChatStore.getState().unreadCount).toBe(0)
    })
  })

  describe('clearUnread', () => {
    it('clears unread count', () => {
      useChatStore.setState({ unreadCount: 5 })
      useChatStore.getState().clearUnread()
      expect(useChatStore.getState().unreadCount).toBe(0)
    })
  })

  describe('clearMessages', () => {
    it('clears all messages and unread count', () => {
      useChatStore.setState({
        messages: [createMessage('1')],
        unreadCount: 3,
      })
      useChatStore.getState().clearMessages()
      expect(useChatStore.getState().messages).toHaveLength(0)
      expect(useChatStore.getState().unreadCount).toBe(0)
    })
  })

  describe('nickname', () => {
    it('initializes nickname as null when no localStorage value', () => {
      // Re-import to get fresh state
      useChatStore.setState({ nickname: null })
      expect(useChatStore.getState().nickname).toBeNull()
    })

    it('setNickname updates state and persists under the signed-in user', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('TestUser')
      expect(useChatStore.getState().nickname).toBe('TestUser')
      expect(localStorage.getItem('chat_nickname:alice')).toBe('TestUser')
      expect(localStorage.getItem('chat_nickname')).toBeNull()
    })

    it('setNickname without a known identity keeps the name in memory only', () => {
      useChatStore.getState().setNickname('TestUser')
      expect(useChatStore.getState().nickname).toBe('TestUser')
      expect(localStorage.length).toBe(0)
    })

    it('setNickname trims whitespace', () => {
      useChatStore.getState().setNickname('  TestUser  ')
      expect(useChatStore.getState().nickname).toBe('TestUser')
    })

    it('setNickname truncates to 30 characters', () => {
      const longName = 'A'.repeat(50)
      useChatStore.getState().setNickname(longName)
      expect(useChatStore.getState().nickname).toBe('A'.repeat(30))
    })

    it('setNickname with empty string sets null', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('TestUser')
      useChatStore.getState().setNickname('')
      expect(useChatStore.getState().nickname).toBeNull()
      expect(localStorage.getItem('chat_nickname:alice')).toBeNull()
    })

    it('setNickname with whitespace-only sets null', () => {
      useChatStore.getState().setNickname('TestUser')
      useChatStore.getState().setNickname('   ')
      expect(useChatStore.getState().nickname).toBeNull()
    })

    it('clearNickname removes nickname and localStorage', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('TestUser')
      useChatStore.getState().clearNickname()
      expect(useChatStore.getState().nickname).toBeNull()
      expect(localStorage.getItem('chat_nickname:alice')).toBeNull()
    })
  })

  describe('identity', () => {
    it('setIdentity records who we are and loads only that user\'s nickname', () => {
      localStorage.setItem('chat_nickname:alice', 'Ally')
      localStorage.setItem('chat_nickname:bob', 'Bobby')
      useChatStore.getState().setIdentity({ username: 'alice' })
      expect(useChatStore.getState().me).toEqual({ username: 'alice' })
      expect(useChatStore.getState().nickname).toBe('Ally')
    })

    it('setIdentity leaves the nickname null when that user has none stored', () => {
      localStorage.setItem('chat_nickname:bob', 'Bobby')
      useChatStore.getState().setIdentity({ username: 'alice' })
      expect(useChatStore.getState().nickname).toBeNull()
    })

    it('a different user replaces the previous user\'s in-memory nickname', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Ally')
      useChatStore.getState().setIdentity({ username: 'bob' })
      expect(useChatStore.getState().me).toEqual({ username: 'bob' })
      expect(useChatStore.getState().nickname).toBeNull()
      // Alice keeps hers for next time
      expect(localStorage.getItem('chat_nickname:alice')).toBe('Ally')
    })

    it('adopts the legacy shared nickname once, for the first user only', () => {
      localStorage.setItem('chat_nickname', 'OldName')
      useChatStore.getState().setIdentity({ username: 'alice' })
      expect(useChatStore.getState().nickname).toBe('OldName')
      expect(localStorage.getItem('chat_nickname:alice')).toBe('OldName')
      expect(localStorage.getItem('chat_nickname')).toBeNull()

      useChatStore.getState().setIdentity({ username: 'bob' })
      expect(useChatStore.getState().nickname).toBeNull()
      expect(localStorage.getItem('chat_nickname:bob')).toBeNull()
    })

    it('a stored per-user nickname wins over the legacy key, which is still deleted', () => {
      localStorage.setItem('chat_nickname', 'OldName')
      localStorage.setItem('chat_nickname:alice', 'Ally')
      useChatStore.getState().setIdentity({ username: 'alice' })
      expect(useChatStore.getState().nickname).toBe('Ally')
      expect(localStorage.getItem('chat_nickname')).toBeNull()
    })

    it('resetIdentity forgets who we are and the nickname in memory', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Ally')
      useChatStore.getState().resetIdentity()
      expect(useChatStore.getState().me).toBeNull()
      expect(useChatStore.getState().nickname).toBeNull()
      expect(localStorage.getItem('chat_nickname:alice')).toBe('Ally')
    })

    it('signing out resets the identity but keeps the stored nickname', () => {
      useAuthStore.getState().setAuth('alice-token', 'viewer', 'alice')
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Ally')

      useAuthStore.getState().logout()

      expect(useChatStore.getState().me).toBeNull()
      expect(useChatStore.getState().nickname).toBeNull()
      expect(localStorage.getItem('chat_nickname:alice')).toBe('Ally')
    })

    it('a new token for a signed-in user keeps the identity', () => {
      useAuthStore.getState().setAuth('alice-token', 'viewer', 'alice')
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Ally')

      useAuthStore.getState().setAuth('alice-token-2', 'viewer', 'alice')

      expect(useChatStore.getState().me).toEqual({ username: 'alice' })
      expect(useChatStore.getState().nickname).toBe('Ally')
    })
  })

  describe('isOwnMessage', () => {
    it('matches the nickname when one is set', () => {
      const state = { nickname: 'Ally', me: { username: 'alice' } }
      expect(isOwnMessage({ username: 'Ally' }, state)).toBe(true)
      expect(isOwnMessage({ username: 'alice' }, state)).toBe(false)
    })

    it('falls back to the sign-in name without a nickname', () => {
      const state = { nickname: null, me: { username: 'alice' } }
      expect(isOwnMessage({ username: 'alice' }, state)).toBe(true)
      expect(isOwnMessage({ username: 'bob' }, state)).toBe(false)
    })

    it('owns nothing while the identity is unknown', () => {
      expect(isOwnMessage({ username: 'alice' }, { nickname: null, me: null })).toBe(false)
    })
  })
})
