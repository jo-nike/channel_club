import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatStore, isOwnMessage, type ChatSender, type ChatSuggester } from './chatStore'
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
      revertNickname: null,
      nicknameRejection: null,
      lastReadAt: null,
      readMarker: null,
      historyReset: false,
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

  describe('system lines', () => {
    const systemLine = (id: string, timestamp = new Date().toISOString()): ChatMessage => ({
      messageId: id,
      username: 'Live TV',
      userId: '',
      content: 'jon put on TSN 5',
      timestamp,
      kind: 'system',
    })

    it('adds them to the list without counting them as unread', () => {
      useChatStore.setState({ isOpen: false })
      useChatStore.getState().addMessage(systemLine('s1'))
      useChatStore.getState().addMessage(createMessage('1'))
      expect(useChatStore.getState().messages.map((m) => m.messageId)).toEqual(['s1', '1'])
      expect(useChatStore.getState().unreadCount).toBe(1)
    })

    it('leaves them out of the unread recount a history does', () => {
      useChatStore.getState().setIdentity({ username: 'me' })
      useChatStore.setState({ lastReadAt: Date.parse('2026-09-26T20:00:01Z') })
      useChatStore.getState().setMessages([
        systemLine('s1', '2026-09-26T20:00:02Z'),
        { ...createMessage('1', 'alice'), timestamp: '2026-09-26T20:00:03Z' },
        systemLine('s2', '2026-09-26T20:00:04Z'),
      ])
      expect(useChatStore.getState().unreadCount).toBe(1)
    })

    it("don't set a 'New' marker when they are all that came in", () => {
      useChatStore.getState().setIdentity({ username: 'me' })
      useChatStore.setState({ lastReadAt: Date.parse('2026-09-26T20:00:01Z') })
      useChatStore.getState().addMessage(systemLine('s1', '2026-09-26T20:00:02Z'))
      useChatStore.getState().setOpen(true)
      expect(useChatStore.getState().readMarker).toBeNull()
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

    it('setIdentity records the userId the server gives this account', () => {
      useChatStore.getState().setIdentity({ username: 'alice', userId: 'u_alice' })
      expect(useChatStore.getState().me).toEqual({ username: 'alice', userId: 'u_alice' })
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

  describe('unread from history', () => {
    // Server timestamps, in the Python isoformat the backend sends
    const at = (second: number) => `2026-09-26T20:00:${String(second).padStart(2, '0')}.123456+00:00`
    const ms = (second: number) => Date.parse(`2026-09-26T20:00:${String(second).padStart(2, '0')}.123Z`)
    const message = (id: string, username: string, second: number): ChatMessage => ({
      messageId: id,
      username,
      content: `Message ${id}`,
      timestamp: at(second),
    })

    beforeEach(() => {
      useChatStore.getState().setIdentity({ username: 'me' })
    })

    it('the first history counts nothing and remembers its newest message as read', () => {
      useChatStore.getState().setMessages([message('1', 'alice', 1), message('2', 'bob', 2)])
      expect(useChatStore.getState().unreadCount).toBe(0)
      expect(useChatStore.getState().lastReadAt).toBe(ms(2))
      expect(localStorage.getItem('chat_last_read:me')).toBe(String(ms(2)))
    })

    it('after an empty first history, messages that later arrive through history are unread', () => {
      // A restarted (or quiet) server sends an empty history to someone with no stored read time
      useChatStore.getState().setMessages([])
      useChatStore.getState().addMessage(message('1', 'alice', 1))
      expect(useChatStore.getState().unreadCount).toBe(1)
      // The socket drops, alice posts twice more, and the reconnect brings them in through history
      useChatStore.getState().setMessages([message('1', 'alice', 1), message('2', 'alice', 2), message('3', 'alice', 3)])
      expect(useChatStore.getState().unreadCount).toBe(3)
      expect(localStorage.getItem('chat_last_read:me')).toBe('0')
      useChatStore.getState().setOpen(true)
      expect(useChatStore.getState().readMarker).toBe(0)
      expect(useChatStore.getState().lastReadAt).toBe(ms(3))
    })

    it('history while closed counts newer messages from other people, not your own', () => {
      useChatStore.setState({ lastReadAt: ms(1) })
      useChatStore.getState().setMessages([
        message('1', 'alice', 1),
        message('2', 'alice', 2),
        message('3', 'me', 3),
        message('4', 'bob', 4),
      ])
      expect(useChatStore.getState().unreadCount).toBe(2)
    })

    it('history while open counts nothing and marks it read', () => {
      useChatStore.setState({ isOpen: true, lastReadAt: ms(1) })
      useChatStore.getState().setMessages([message('1', 'alice', 1), message('2', 'bob', 2)])
      expect(useChatStore.getState().unreadCount).toBe(0)
      expect(useChatStore.getState().lastReadAt).toBe(ms(2))
    })

    it("doesn't count your own messages from another tab or device as they arrive", () => {
      useChatStore.setState({ lastReadAt: ms(1) })
      useChatStore.getState().addMessage(message('2', 'me', 2))
      expect(useChatStore.getState().unreadCount).toBe(0)
      useChatStore.getState().addMessage(message('3', 'alice', 3))
      expect(useChatStore.getState().unreadCount).toBe(1)
      // Under a nickname, that's the name your messages carry
      useChatStore.getState().setNickname('Nick')
      useChatStore.getState().addMessage(message('4', 'Nick', 4))
      expect(useChatStore.getState().unreadCount).toBe(1)
    })

    it('keeps the badge steady when a reconnect brings your own message back through history', () => {
      useChatStore.setState({ lastReadAt: ms(1) })
      const own = message('2', 'me', 2)
      const theirs = message('3', 'alice', 3)
      useChatStore.getState().addMessage(own)
      useChatStore.getState().addMessage(theirs)
      expect(useChatStore.getState().unreadCount).toBe(1)
      useChatStore.getState().setMessages([message('1', 'bob', 1), own, theirs])
      expect(useChatStore.getState().unreadCount).toBe(1)
    })

    it('a message counted as it arrived is not counted again when history repeats it', () => {
      useChatStore.setState({ lastReadAt: ms(1) })
      const late = message('2', 'alice', 2)
      useChatStore.getState().addMessage(late)
      expect(useChatStore.getState().unreadCount).toBe(1)
      useChatStore.getState().setMessages([message('1', 'bob', 1), late])
      expect(useChatStore.getState().unreadCount).toBe(1)
    })

    it('opening marks where unread starts, reads everything and clears the badge', () => {
      useChatStore.setState({ lastReadAt: ms(1) })
      useChatStore.getState().setMessages([message('1', 'alice', 1), message('2', 'bob', 2)])
      useChatStore.getState().setOpen(true)
      const state = useChatStore.getState()
      expect(state.unreadCount).toBe(0)
      expect(state.readMarker).toBe(ms(1))
      expect(state.lastReadAt).toBe(ms(2))
      expect(localStorage.getItem('chat_last_read:me')).toBe(String(ms(2)))
    })

    it('opening with nothing unread sets no marker', () => {
      useChatStore.setState({ lastReadAt: ms(2) })
      useChatStore.getState().setMessages([message('1', 'alice', 1), message('2', 'me', 3)])
      useChatStore.getState().toggleOpen()
      expect(useChatStore.getState().readMarker).toBeNull()
    })

    it('closing reads everything and drops the marker', () => {
      useChatStore.setState({ lastReadAt: ms(1) })
      useChatStore.getState().setMessages([message('1', 'alice', 1), message('2', 'bob', 2)])
      useChatStore.getState().toggleOpen()
      useChatStore.setState({ messages: [...useChatStore.getState().messages, message('3', 'bob', 3)] })
      useChatStore.getState().toggleOpen()
      expect(useChatStore.getState().readMarker).toBeNull()
      expect(useChatStore.getState().lastReadAt).toBe(ms(3))
    })

    it('a message arriving while open is read', () => {
      useChatStore.setState({ lastReadAt: ms(1) })
      useChatStore.getState().setOpen(true)
      useChatStore.getState().addMessage(message('5', 'alice', 5))
      expect(useChatStore.getState().lastReadAt).toBe(ms(5))
      expect(localStorage.getItem('chat_last_read:me')).toBe(String(ms(5)))
    })

    it('read state never moves backwards', () => {
      useChatStore.setState({ isOpen: true, lastReadAt: ms(9) })
      useChatStore.getState().setMessages([message('1', 'alice', 1)])
      expect(useChatStore.getState().lastReadAt).toBe(ms(9))
    })

    it('is kept per user: each sign-in loads its own last-read time', () => {
      localStorage.setItem('chat_last_read:alice', String(ms(4)))
      useChatStore.getState().setIdentity({ username: 'alice' })
      expect(useChatStore.getState().lastReadAt).toBe(ms(4))
      useChatStore.getState().setIdentity({ username: 'bob' })
      expect(useChatStore.getState().lastReadAt).toBeNull()
      useChatStore.getState().resetIdentity()
      expect(useChatStore.getState().lastReadAt).toBeNull()
    })

    it('a reconnect as the same user keeps the marker of an open panel', () => {
      useChatStore.setState({ lastReadAt: ms(1) })
      useChatStore.getState().setMessages([message('1', 'alice', 1), message('2', 'bob', 2)])
      useChatStore.getState().setOpen(true)
      useChatStore.getState().setIdentity({ username: 'me' })
      expect(useChatStore.getState().readMarker).toBe(ms(1))
      expect(useChatStore.getState().lastReadAt).toBe(ms(2))
    })
  })

  describe('historyReset', () => {
    it('is raised when an empty history replaces messages', () => {
      useChatStore.getState().setMessages([createMessage('1'), createMessage('2')])
      useChatStore.getState().setMessages([])
      expect(useChatStore.getState().historyReset).toBe(true)
      expect(useChatStore.getState().messages).toHaveLength(0)
    })

    it('is not raised by an empty first history', () => {
      useChatStore.getState().setMessages([])
      expect(useChatStore.getState().historyReset).toBe(false)
    })

    it('stays up while new messages arrive, and another empty history keeps it', () => {
      useChatStore.getState().setMessages([createMessage('1')])
      useChatStore.getState().setMessages([])
      useChatStore.getState().addMessage(createMessage('2'))
      expect(useChatStore.getState().historyReset).toBe(true)
      useChatStore.setState({ messages: [] })
      useChatStore.getState().setMessages([])
      expect(useChatStore.getState().historyReset).toBe(true)
    })

    it('is cleared by a history with messages and by clearMessages', () => {
      useChatStore.getState().setMessages([createMessage('1')])
      useChatStore.getState().setMessages([])
      useChatStore.getState().setMessages([createMessage('2')])
      expect(useChatStore.getState().historyReset).toBe(false)

      useChatStore.getState().setMessages([])
      useChatStore.getState().clearMessages()
      expect(useChatStore.getState().historyReset).toBe(false)
    })
  })

  describe('nickname refused by the server', () => {
    it('goes back to the previous nickname, in memory and in storage, and records the refusal', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Ally')
      useChatStore.getState().setNickname('Bob')

      useChatStore.getState().rejectNickname('Bob')

      expect(useChatStore.getState().nickname).toBe('Ally')
      expect(localStorage.getItem('chat_nickname:alice')).toBe('Ally')
      expect(useChatStore.getState().nicknameRejection).toEqual({ nickname: 'Bob' })
    })

    it('goes back to the sign-in name when the refused name was the first one set', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Bob')

      useChatStore.getState().rejectNickname('Bob')

      expect(useChatStore.getState().nickname).toBeNull()
      expect(localStorage.getItem('chat_nickname:alice')).toBeNull()
    })

    it('a stored nickname refused after connecting falls back to the sign-in name', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Ally')
      // Reconnect: the new socket starts on the sign-in name, then sends the stored one
      useChatStore.getState().setIdentity({ username: 'alice' })
      expect(useChatStore.getState().nickname).toBe('Ally')

      useChatStore.getState().rejectNickname('Ally')

      expect(useChatStore.getState().nickname).toBeNull()
      expect(localStorage.getItem('chat_nickname:alice')).toBeNull()
      expect(useChatStore.getState().nicknameRejection).toEqual({ nickname: 'Ally' })
    })

    it('ignores the refusal of a name that is no longer in use', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Bob')
      useChatStore.getState().setNickname('Carol')

      useChatStore.getState().rejectNickname('Bob')

      expect(useChatStore.getState().nickname).toBe('Carol')
      expect(localStorage.getItem('chat_nickname:alice')).toBe('Carol')
      expect(useChatStore.getState().nicknameRejection).toBeNull()
    })

    it('a new refusal of the same name is a new rejection', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Bob')
      useChatStore.getState().rejectNickname('Bob')
      const first = useChatStore.getState().nicknameRejection

      useChatStore.getState().setNickname('Bob')
      useChatStore.getState().rejectNickname('Bob')

      expect(useChatStore.getState().nicknameRejection).toEqual({ nickname: 'Bob' })
      expect(useChatStore.getState().nicknameRejection).not.toBe(first)
    })

    it('is cleared by clearNicknameRejection, by signing out and by another user signing in', () => {
      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Bob')
      useChatStore.getState().rejectNickname('Bob')
      useChatStore.getState().clearNicknameRejection()
      expect(useChatStore.getState().nicknameRejection).toBeNull()

      useChatStore.getState().setNickname('Bob')
      useChatStore.getState().rejectNickname('Bob')
      useChatStore.getState().resetIdentity()
      expect(useChatStore.getState().nicknameRejection).toBeNull()

      useChatStore.getState().setIdentity({ username: 'alice' })
      useChatStore.getState().setNickname('Bob')
      useChatStore.getState().rejectNickname('Bob')
      useChatStore.getState().setIdentity({ username: 'carol' })
      expect(useChatStore.getState().nicknameRejection).toBeNull()
    })
  })

  describe('isOwnMessage', () => {
    it('decides by userId when both the message and the identity have one', () => {
      const state = { nickname: 'Ally', me: { username: 'alice', userId: 'u_alice' } }
      // Sent before a rename: still yours
      expect(isOwnMessage({ username: 'alice', userId: 'u_alice' }, state)).toBe(true)
      // Someone else using your nickname: not yours
      expect(isOwnMessage({ username: 'Ally', userId: 'u_bob' }, state)).toBe(false)
    })

    it('falls back to names for messages without a userId', () => {
      const state = { nickname: 'Ally', me: { username: 'alice', userId: 'u_alice' } }
      expect(isOwnMessage({ username: 'Ally' }, state)).toBe(true)
      expect(isOwnMessage({ username: 'bob' }, state)).toBe(false)
    })

    it('falls back to names before the server has said who you are', () => {
      expect(isOwnMessage({ username: 'Ally', userId: 'u_bob' }, { nickname: 'Ally', me: null })).toBe(true)
    })

    it('keeps your earlier messages yours after a rename, so they are not counted as unread', () => {
      useChatStore.getState().setIdentity({ username: 'alice', userId: 'u_alice' })
      const earlier = { ...createMessage('1', 'alice'), userId: 'u_alice' }
      useChatStore.getState().addMessage(earlier)

      useChatStore.getState().setNickname('Ally')

      expect(isOwnMessage(earlier, useChatStore.getState())).toBe(true)
      expect(useChatStore.getState().unreadCount).toBe(0)
      // Someone else's message under your new name arrives: it is theirs, and unread
      useChatStore.getState().addMessage({ ...createMessage('2', 'Ally'), userId: 'u_bob' })
      expect(useChatStore.getState().unreadCount).toBe(1)
    })

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

    it('never owns a system line, even under a matching nickname', () => {
      const state = { nickname: 'Live TV', me: { username: 'alice', userId: 'u_alice' } }
      expect(isOwnMessage({ username: 'Live TV', userId: '', kind: 'system' }, state)).toBe(false)
      expect(isOwnMessage({ username: 'Live TV', userId: '' }, state)).toBe(true)
    })

    it('owns nothing while the identity is unknown', () => {
      expect(isOwnMessage({ username: 'alice' }, { nickname: null, me: null })).toBe(false)
    })
  })

  describe('sender', () => {
    it('sends nothing while no view has registered a sender', async () => {
      await expect(useChatStore.getState().sendMessage('hello')).resolves.toBe('not-sent')
    })

    it('sends through the registered sender and returns its result', async () => {
      const sender = vi.fn<ChatSender>(() => Promise.resolve('acknowledged'))
      const unregister = useChatStore.getState().registerSender(sender)

      await expect(useChatStore.getState().sendMessage('hello', 'c-1')).resolves.toBe('acknowledged')
      expect(sender).toHaveBeenCalledWith('hello', 'c-1')
      unregister()
    })

    it('reports a sender that throws as unconfirmed', async () => {
      const unregister = useChatStore.getState().registerSender(() => Promise.reject(new Error('socket gone')))
      await expect(useChatStore.getState().sendMessage('hello')).resolves.toBe('unconfirmed')
      unregister()
    })

    it('stops sending once the sender unregisters', async () => {
      const sender = vi.fn<ChatSender>(() => Promise.resolve('acknowledged'))
      useChatStore.getState().registerSender(sender)()

      await expect(useChatStore.getState().sendMessage('hello')).resolves.toBe('not-sent')
      expect(sender).not.toHaveBeenCalled()
    })

    it("an old registration's unregister leaves a newer sender in place", async () => {
      const older = vi.fn<ChatSender>(() => Promise.resolve('acknowledged'))
      const newer = vi.fn<ChatSender>(() => Promise.resolve('acknowledged'))
      const unregisterOlder = useChatStore.getState().registerSender(older)
      const unregisterNewer = useChatStore.getState().registerSender(newer)

      unregisterOlder()
      await useChatStore.getState().sendMessage('hello')
      expect(newer).toHaveBeenCalledWith('hello', undefined)
      expect(older).not.toHaveBeenCalled()
      unregisterNewer()
    })
  })

  describe('suggester', () => {
    it('suggests nothing while no view has registered a suggester', async () => {
      await expect(useChatStore.getState().suggestChannel('42')).resolves.toBe('not-sent')
    })

    it('suggests through the registered suggester, not the chat sender, and returns its result', async () => {
      const sender = vi.fn<ChatSender>(() => Promise.resolve('acknowledged'))
      const suggester = vi.fn<ChatSuggester>(() => Promise.resolve('unconfirmed'))
      const unregisterSender = useChatStore.getState().registerSender(sender)
      const unregisterSuggester = useChatStore.getState().registerSuggester(suggester)

      await expect(useChatStore.getState().suggestChannel('42', 'c-1')).resolves.toBe('unconfirmed')
      expect(suggester).toHaveBeenCalledWith('42', 'c-1')
      expect(sender).not.toHaveBeenCalled()
      unregisterSender()
      unregisterSuggester()
    })

    it('reports a suggester that throws as unconfirmed', async () => {
      const unregister = useChatStore.getState().registerSuggester(() => Promise.reject(new Error('socket gone')))
      await expect(useChatStore.getState().suggestChannel('42')).resolves.toBe('unconfirmed')
      unregister()
    })

    it("an old registration's unregister leaves a newer suggester in place", async () => {
      const older = vi.fn<ChatSuggester>(() => Promise.resolve('acknowledged'))
      const newer = vi.fn<ChatSuggester>(() => Promise.resolve('acknowledged'))
      const unregisterOlder = useChatStore.getState().registerSuggester(older)
      const unregisterNewer = useChatStore.getState().registerSuggester(newer)

      unregisterOlder()
      await useChatStore.getState().suggestChannel('42')
      expect(newer).toHaveBeenCalledWith('42', undefined)
      expect(older).not.toHaveBeenCalled()

      unregisterNewer()
      await expect(useChatStore.getState().suggestChannel('42')).resolves.toBe('not-sent')
    })
  })
})
