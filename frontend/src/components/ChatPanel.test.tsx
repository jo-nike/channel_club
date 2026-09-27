import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@/test/utils'
import { ChatPanel } from './ChatPanel'
import { useChatStore } from '@/stores/chatStore'
import type { ChatMessage } from '@/types'

// Stand-in for the GIF picker, which fetches its feature flag: a click picks one fixed GIF
const GIF_URL = 'https://media.example/cat.gif'
vi.mock('./GifButton', () => ({
  GifButton: ({ disabled, onSelect }: { disabled?: boolean; onSelect: (url: string) => void }) => (
    <button type="button" aria-label="Send GIF" disabled={disabled} onClick={() => onSelect(GIF_URL)} />
  ),
}))

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

const createMessage = (
  id: string,
  username: string = 'TestUser'
): ChatMessage => ({
  messageId: id,
  username,
  content: `Message ${id}`,
  timestamp: new Date().toISOString(),
})

describe('ChatPanel', () => {
  const mockOnSendMessage = vi.fn()

  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isOpen: true,
      unreadCount: 0,
      nickname: 'TestUser',
      me: null,
      revertNickname: null,
      nicknameRejection: null,
      lastReadAt: null,
      readMarker: null,
      historyReset: false,
    })
    mockOnSendMessage.mockReset().mockReturnValue('acknowledged')
  })

  it('renders when isOpen is true', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    expect(screen.getByText('Chat')).toBeInTheDocument()
  })

  it('is the chat-panel element the header chat toggle controls', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    expect(screen.getByRole('heading', { name: 'Chat' }).closest('#chat-panel')).not.toBeNull()
  })

  it('does not render when isOpen is false', () => {
    useChatStore.setState({ isOpen: false })
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    expect(screen.queryByText('Chat')).not.toBeInTheDocument()
  })

  it('shows empty state when no messages', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    expect(screen.getByText('No messages yet. Say hello!')).toBeInTheDocument()
  })

  it('renders messages', () => {
    useChatStore.setState({
      messages: [
        createMessage('1', 'User1'),
        createMessage('2', 'User2'),
      ],
      isOpen: true,
    })
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    expect(screen.getByText('Message 1')).toBeInTheDocument()
    expect(screen.getByText('Message 2')).toBeInTheDocument()
  })

  it('sends message on Enter key', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')

    fireEvent.change(input, { target: { value: 'Hello world!' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockOnSendMessage).toHaveBeenCalledWith('Hello world!', expect.stringMatching(/^[0-9a-f]{32}$/))
  })

  it('sends message on button click', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')
    const sendButton = screen.getByRole('button', { name: 'Send message' })

    fireEvent.change(input, { target: { value: 'Hello world!' } })
    fireEvent.click(sendButton)

    expect(mockOnSendMessage).toHaveBeenCalledWith('Hello world!', expect.stringMatching(/^[0-9a-f]{32}$/))
  })

  it('clears input after sending', async () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')

    fireEvent.change(input, { target: { value: 'Hello!' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('does not send empty messages', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockOnSendMessage).not.toHaveBeenCalled()
  })

  it('closes panel when close button is clicked', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const closeButton = screen.getByRole('button', { name: 'Close chat' })

    fireEvent.click(closeButton)

    expect(useChatStore.getState().isOpen).toBe(false)
  })

  it('marks own messages correctly', () => {
    useChatStore.setState({
      messages: [
        createMessage('1', 'CurrentUser'),
        createMessage('2', 'OtherUser'),
      ],
      isOpen: true,
      nickname: 'CurrentUser', // Use nickname from store
    })
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)

    // Own message should not show username
    expect(screen.queryByText('CurrentUser')).not.toBeInTheDocument()
    // Other user's message should show username
    expect(screen.getByText('OtherUser')).toBeInTheDocument()
  })

  it("moves 'just now' on to a clock time while the panel stays open", () => {
    vi.useFakeTimers()
    try {
      const sentAt = new Date('2026-01-08T12:00:00Z')
      vi.setSystemTime(sentAt)
      useChatStore.setState({ messages: [{ ...createMessage('1', 'OtherUser'), timestamp: sentAt.toISOString() }] })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getByText('just now')).toBeInTheDocument()

      // Two 30s ticks of the shared clock
      act(() => { vi.advanceTimersByTime(60_000) })
      const clock = sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      expect(screen.queryByText('just now')).not.toBeInTheDocument()
      expect(screen.getByText(clock)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('has max length on input', () => {
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')
    expect(input).toHaveAttribute('maxLength', '500')
  })

  describe('chat identity', () => {
    beforeEach(() => {
      localStorage.clear()
      useChatStore.setState({ nickname: null, me: { username: 'testuser' }, isOpen: true })
    })

    it('goes straight to chat without asking for a display name', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.queryByRole('heading', { name: 'Change display name' })).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText('Display name')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    })

    it('says you are chatting as your sign-in name', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getByText('Chatting as testuser')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit nickname' })).toBeInTheDocument()
    })

    it('says you are chatting as your nickname when one is set', () => {
      useChatStore.setState({ nickname: 'TestNick' })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getByText('Chatting as TestNick')).toBeInTheDocument()
    })

    it('shows no identity line until the server says who you are', () => {
      useChatStore.setState({ me: null })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.queryByText(/Chatting as/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Edit nickname' })).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    })

    it('treats messages under the sign-in name as your own when no nickname is set', () => {
      useChatStore.setState({
        messages: [createMessage('1', 'testuser'), createMessage('2', 'OtherUser')],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      // Own message should not show username
      expect(screen.queryByText('testuser')).not.toBeInTheDocument()
      // Other user's message should show username
      expect(screen.getByText('OtherUser')).toBeInTheDocument()
    })

    it('uses store nickname for own message detection', () => {
      useChatStore.setState({
        nickname: 'MyNickname',
        messages: [
          createMessage('1', 'MyNickname'),
          createMessage('2', 'OtherUser'),
        ],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      // Own message should not show username
      expect(screen.queryByText('MyNickname')).not.toBeInTheDocument()
      // Other user's message should show username
      expect(screen.getByText('OtherUser')).toBeInTheDocument()
    })

    it('does not disable the GIF button for want of a nickname', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getByRole('button', { name: 'Send GIF' })).toBeEnabled()
    })

    it('opens the editor from the pencil and saves a nickname', () => {
      const mockSetNickname = vi.fn()
      render(
        <ChatPanel
          onSendMessage={mockOnSendMessage}
          onSetNickname={mockSetNickname}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
      const input = screen.getByPlaceholderText('Display name')
      fireEvent.change(input, { target: { value: 'TestNick' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockSetNickname).toHaveBeenCalledWith('TestNick')
      expect(useChatStore.getState().nickname).toBe('TestNick')
      expect(localStorage.getItem('chat_nickname:testuser')).toBe('TestNick')
      expect(screen.queryByPlaceholderText('Display name')).not.toBeInTheDocument()
      expect(screen.getByText('Chatting as TestNick')).toBeInTheDocument()
    })

    it('pre-fills the editor with the current nickname', () => {
      useChatStore.setState({ nickname: 'TestNick' })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))

      expect(screen.getByPlaceholderText('Display name')).toHaveValue('TestNick')
    })

    it('goes back to the sign-in name with an empty set_nickname', () => {
      const mockSetNickname = vi.fn()
      useChatStore.getState().setNickname('TestNick')
      render(
        <ChatPanel
          onSendMessage={mockOnSendMessage}
          onSetNickname={mockSetNickname}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
      fireEvent.click(screen.getByRole('button', { name: 'Use my sign-in name' }))

      expect(mockSetNickname).toHaveBeenCalledWith('')
      expect(useChatStore.getState().nickname).toBeNull()
      expect(localStorage.getItem('chat_nickname:testuser')).toBeNull()
      expect(screen.getByText('Chatting as testuser')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    })

    it('reads as changing a name, not a gate to pass', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))

      expect(screen.getByRole('heading', { name: 'Change display name' })).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Display name')).toBeInTheDocument()
      expect(screen.queryByText('Choose a display name')).not.toBeInTheDocument()
    })

    it('Cancel closes the editor and keeps the current nickname, discarding the edit', () => {
      const mockSetNickname = vi.fn()
      useChatStore.getState().setNickname('TestNick')
      render(<ChatPanel onSendMessage={mockOnSendMessage} onSetNickname={mockSetNickname} />)

      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
      fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Other' } })
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByPlaceholderText('Display name')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
      expect(screen.getByText('Chatting as TestNick')).toBeInTheDocument()
      expect(mockSetNickname).not.toHaveBeenCalled()
      expect(useChatStore.getState().nickname).toBe('TestNick')
      expect(localStorage.getItem('chat_nickname:testuser')).toBe('TestNick')

      // Reopening starts from the saved name, not the abandoned edit
      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
      expect(screen.getByPlaceholderText('Display name')).toHaveValue('TestNick')
    })

    it('keeps your earlier messages on your side after a rename, and someone else under your new name on theirs', () => {
      useChatStore.setState({
        me: { username: 'testuser', userId: 'u_me' },
        messages: [
          { ...createMessage('1', 'testuser'), userId: 'u_me' },
          { ...createMessage('2', 'TestNick'), userId: 'u_other' },
        ],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} onSetNickname={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
      fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'TestNick' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(screen.getByText('Chatting as TestNick')).toBeInTheDocument()
      // Own messages show no name, other people's do
      expect(screen.queryByText('testuser')).not.toBeInTheDocument()
      expect(screen.getByText('TestNick')).toBeInTheDocument()
    })

    it('reopens the editor on a refused name, says why, and keeps the old name', () => {
      const mockSetNickname = vi.fn()
      useChatStore.getState().setNickname('Ace')
      render(<ChatPanel onSendMessage={mockOnSendMessage} onSetNickname={mockSetNickname} />)

      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
      fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Jon' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(mockSetNickname).toHaveBeenCalledWith('Jon')
      expect(screen.queryByPlaceholderText('Display name')).not.toBeInTheDocument()

      // The server answers nickname_taken
      act(() => {
        useChatStore.getState().rejectNickname('Jon')
      })

      const input = screen.getByPlaceholderText('Display name')
      expect(input).toHaveValue('Jon')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByRole('alert')).toHaveTextContent("“Jon” is another member's sign-in name")
      expect(input).toHaveAccessibleDescription(/another member's sign-in name/)
      expect(useChatStore.getState().nickname).toBe('Ace')
      expect(localStorage.getItem('chat_nickname:testuser')).toBe('Ace')

      // Cancel keeps the old name and drops the error
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByText('Chatting as Ace')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(useChatStore.getState().nicknameRejection).toBeNull()
    })

    it('saving a different name after a refusal clears the error', () => {
      const mockSetNickname = vi.fn()
      render(<ChatPanel onSendMessage={mockOnSendMessage} onSetNickname={mockSetNickname} />)
      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
      fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Jon' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      act(() => {
        useChatStore.getState().rejectNickname('Jon')
      })

      fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Jonny' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockSetNickname).toHaveBeenLastCalledWith('Jonny')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByText('Chatting as Jonny')).toBeInTheDocument()
    })

    it('shows a refusal that arrived before the panel was opened', () => {
      // A stored nickname refused on connect: the sign-in name is in use again
      useChatStore.setState({ nickname: null, nicknameRejection: { nickname: 'Jon' } })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      expect(screen.getByPlaceholderText('Display name')).toHaveValue('Jon')
      expect(screen.getByRole('alert')).toHaveTextContent("“Jon” is another member's sign-in name")
    })

    it('Escape closes the editor without changing anything and without reaching the rest of the page', () => {
      const mockSetNickname = vi.fn()
      const pageKeyDown = vi.fn()
      window.addEventListener('keydown', pageKeyDown)
      try {
        render(<ChatPanel onSendMessage={mockOnSendMessage} onSetNickname={mockSetNickname} />)

        fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
        const input = screen.getByPlaceholderText('Display name')
        fireEvent.change(input, { target: { value: 'Other' } })
        fireEvent.keyDown(input, { key: 'Escape' })

        expect(screen.queryByPlaceholderText('Display name')).not.toBeInTheDocument()
        expect(useChatStore.getState().isOpen).toBe(true)
        expect(screen.getByText('Chatting as testuser')).toBeInTheDocument()
        expect(mockSetNickname).not.toHaveBeenCalled()
        expect(useChatStore.getState().nickname).toBeNull()
        // Page-level Escape handlers (theater, and any close-chat shortcut) never see it
        expect(pageKeyDown).not.toHaveBeenCalled()
      } finally {
        window.removeEventListener('keydown', pageKeyDown)
      }
    })
  })
  it('FE-11 preserves failed drafts and clears only after matching acknowledgement', async () => {
    mockOnSendMessage.mockReturnValueOnce('not-sent').mockReturnValueOnce('acknowledged')
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')
    fireEvent.change(input, { target: { value: 'Keep this message' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Not sent. You're offline or reconnecting."))
    expect(input).toHaveValue('Keep this message')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(input).toHaveValue(''))
    // The acknowledged send clears the failure row
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockOnSendMessage).toHaveBeenCalledTimes(2)
  })
  it('FE-11 keeps the draft pending and preserves new edits when its old send is acknowledged', async () => {
    let finish!: (result: string) => void
    mockOnSendMessage.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')
    fireEvent.change(input, { target: { value: 'First' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('First')
    expect(screen.getByRole('status')).toHaveTextContent('Sending…')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockOnSendMessage).toHaveBeenCalledTimes(1)
    fireEvent.change(input, { target: { value: 'New draft' } })
    await act(async () => finish('acknowledged'))
    expect(input).toHaveValue('New draft')
  })
  it('FE-11 retains a draft when delivery becomes uncertain after send', async () => {
    mockOnSendMessage.mockResolvedValue('unconfirmed')
    render(<ChatPanel onSendMessage={mockOnSendMessage} />)
    const input = screen.getByPlaceholderText('Type a message...')
    fireEvent.change(input, { target: { value: 'Uncertain' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't confirm it was sent."))
    expect(input).toHaveValue('Uncertain')
  })

  describe('history reset', () => {
    const notice = 'Chat history was cleared (server restart or an admin cleared it)'

    it('says so when the server sends an empty history over earlier messages', () => {
      useChatStore.getState().setMessages([createMessage('1', 'OtherUser')])
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.queryByText(notice)).not.toBeInTheDocument()

      act(() => useChatStore.getState().setMessages([]))
      expect(screen.getByText(notice)).toBeInTheDocument()
      expect(screen.queryByText('Message 1')).not.toBeInTheDocument()

      // It stays above messages posted after the reset
      act(() => useChatStore.getState().addMessage(createMessage('2', 'OtherUser')))
      expect(screen.getByText(notice)).toBeInTheDocument()
      expect(screen.getByText('Message 2')).toBeInTheDocument()
    })

    it('says nothing on an empty first history', () => {
      useChatStore.getState().setMessages([])
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.queryByText(notice)).not.toBeInTheDocument()
      expect(screen.getByText('No messages yet. Say hello!')).toBeInTheDocument()
    })
  })

  describe("'New' divider", () => {
    const at = (second: number) => `2026-09-26T20:00:${String(second).padStart(2, '0')}.000000+00:00`
    const message = (id: string, username: string, second: number): ChatMessage => ({
      messageId: id,
      username,
      content: `Message ${id}`,
      timestamp: at(second),
    })

    it('sits right before the first unread message from someone else', () => {
      useChatStore.setState({
        messages: [
          message('1', 'OtherUser', 1),
          message('2', 'TestUser', 3), // own, newer than the marker
          message('3', 'OtherUser', 4),
          message('4', 'OtherUser', 5),
        ],
        readMarker: Date.parse(at(2)),
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      const divider = screen.getByRole('separator', { name: 'New messages' })
      expect(divider).toHaveTextContent('New')
      expect(screen.getAllByRole('separator', { name: 'New messages' })).toHaveLength(1)
      const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      expect(follows(screen.getByText('Message 2'), divider)).toBe(true)
      expect(follows(divider, screen.getByText('Message 3'))).toBe(true)
    })

    it('is not shown without a marker', () => {
      useChatStore.setState({ messages: [message('1', 'OtherUser', 1)], readMarker: null })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.queryByRole('separator', { name: 'New messages' })).not.toBeInTheDocument()
    })

    it('is not shown when only your own messages are newer than the marker', () => {
      useChatStore.setState({
        messages: [message('1', 'OtherUser', 1), message('2', 'TestUser', 3)],
        readMarker: Date.parse(at(2)),
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.queryByRole('separator', { name: 'New messages' })).not.toBeInTheDocument()
    })

    it('appears when opening the panel over messages that came in through history', () => {
      useChatStore.setState({ isOpen: false, lastReadAt: Date.parse(at(1)) })
      useChatStore.getState().setMessages([message('1', 'OtherUser', 1), message('2', 'OtherUser', 2)])
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      act(() => useChatStore.getState().setOpen(true))
      const divider = screen.getByRole('separator', { name: 'New messages' })
      expect(Boolean(divider.compareDocumentPosition(screen.getByText('Message 2')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    })
  })

  describe('connection row', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows no row and allows sending while connected', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} status="connected" onReconnect={vi.fn()} />)
      fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: 'Hi' } })
      expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument()
      expect(screen.queryByText('Chat is offline')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Send GIF' })).toBeEnabled()
    })

    it("says 'Reconnecting…' only after 2s, and holds sends while keeping the draft editable", () => {
      vi.useFakeTimers()
      render(<ChatPanel onSendMessage={mockOnSendMessage} status="reconnecting" onReconnect={vi.fn()} />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Keep me' } })

      act(() => vi.advanceTimersByTime(1999))
      expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1))
      expect(screen.getByText('Reconnecting…')).toBeInTheDocument()

      expect(input).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Send GIF' })).toBeDisabled()
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(mockOnSendMessage).not.toHaveBeenCalled()
      expect(input).toHaveValue('Keep me')
    })

    it('waits the full delay again after a reconnect succeeds and the connection drops again', () => {
      vi.useFakeTimers()
      const { rerender } = render(<ChatPanel onSendMessage={mockOnSendMessage} status="connecting" />)
      act(() => vi.advanceTimersByTime(2000))
      expect(screen.getByText('Reconnecting…')).toBeInTheDocument()

      rerender(<ChatPanel onSendMessage={mockOnSendMessage} status="connected" />)
      expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument()

      rerender(<ChatPanel onSendMessage={mockOnSendMessage} status="reconnecting" />)
      expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(2000))
      expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
    })

    it("says 'Chat is offline' with a Reconnect button that reconnects", () => {
      const onReconnect = vi.fn()
      render(<ChatPanel onSendMessage={mockOnSendMessage} status="disconnected" onReconnect={onReconnect} />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Draft' } })

      expect(screen.getByText('Chat is offline')).toBeInTheDocument()
      expect(input).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Send GIF' })).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
      expect(onReconnect).toHaveBeenCalledTimes(1)
    })

    it('keeps the offline row, its copy and Reconnect steady through slow retry attempts until connected', () => {
      vi.useFakeTimers()
      const onReconnect = vi.fn()
      const panel = (status: 'disconnected' | 'reconnecting' | 'connected') => (
        <ChatPanel onSendMessage={mockOnSendMessage} status={status} onReconnect={onReconnect} />
      )
      const { rerender } = render(panel('disconnected'))
      const row = screen.getByText('Chat is offline').closest('[role="status"]')
      expect(row).not.toBeNull()

      // A slow retry attempt starts: the same row stays, with the same copy and button
      rerender(panel('reconnecting'))
      expect(screen.getByText('Chat is offline').closest('[role="status"]')).toBe(row)
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled()
      // ...and the delayed 'Reconnecting…' row never stacks a second row on top
      act(() => vi.advanceTimersByTime(5000))
      expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument()
      expect(screen.getByText('Chat is offline').closest('[role="status"]')).toBe(row)
      fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
      expect(onReconnect).toHaveBeenCalledTimes(1)

      // The attempt fails and the next one waits ~30 s: still the same row
      rerender(panel('disconnected'))
      expect(screen.getByText('Chat is offline').closest('[role="status"]')).toBe(row)
      rerender(panel('reconnecting'))
      expect(screen.getByText('Chat is offline').closest('[role="status"]')).toBe(row)

      // Back online: the row goes
      rerender(panel('connected'))
      expect(screen.queryByText('Chat is offline')).not.toBeInTheDocument()
      expect(row).not.toBeInTheDocument()

      // A fresh blip after that gets the 2 s grace again
      rerender(panel('reconnecting'))
      expect(screen.queryByText('Chat is offline')).not.toBeInTheDocument()
      expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(2000))
      expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
    })

    it('holds Retry while offline', async () => {
      mockOnSendMessage.mockReturnValue('not-sent')
      const { rerender } = render(<ChatPanel onSendMessage={mockOnSendMessage} status="connected" />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Offline soon' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await screen.findByRole('alert')

      rerender(<ChatPanel onSendMessage={mockOnSendMessage} status="disconnected" />)
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
      rerender(<ChatPanel onSendMessage={mockOnSendMessage} status="connected" />)
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    })
  })

  describe('send feedback', () => {
    it('confirms an acknowledged send to screen readers only, with no visible status line', async () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Hello' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(input).toHaveValue(''))
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('Message sent')
      expect(status).toHaveClass('sr-only')
      expect(screen.queryByText(/accepted by server/)).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows a spinner in the Send button while sending', async () => {
      let finish!: (result: string) => void
      mockOnSendMessage.mockReturnValue(new Promise((resolve) => { finish = resolve }))
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Hello' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      const sendButton = screen.getByRole('button', { name: 'Send message' })
      expect(sendButton).toBeDisabled()
      expect(sendButton.querySelector('.lucide-loader-circle')).toHaveClass('motion-safe:animate-spin')
      await act(async () => finish('acknowledged'))
      expect(sendButton.querySelector('.lucide-loader-circle')).toBeNull()
    })

    it('puts the failure row in the composer, below the message list', async () => {
      mockOnSendMessage.mockReturnValue('not-sent')
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Offline' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      const alert = await screen.findByRole('alert')
      // The row sits right above the input, not above the panel header
      expect(alert.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(alert.compareDocumentPosition(screen.getByText('Chat')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    })

    it('Retry after a failed GIF resends the GIF with the same id and keeps the text draft', async () => {
      mockOnSendMessage.mockReturnValueOnce('not-sent').mockReturnValueOnce('acknowledged')
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'A half-typed thought' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send GIF' }))
      await screen.findByRole('alert')
      const [[content, clientMessageId]] = mockOnSendMessage.mock.calls
      expect(content).toBe(GIF_URL)

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
      expect(mockOnSendMessage).toHaveBeenLastCalledWith(GIF_URL, clientMessageId)
      expect(input).toHaveValue('A half-typed thought')
    })

    it('Retry resends a failed text message with the same id and then clears the draft', async () => {
      mockOnSendMessage.mockReturnValueOnce('not-sent').mockReturnValueOnce('acknowledged')
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Goal!' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await screen.findByRole('alert')
      const clientMessageId = mockOnSendMessage.mock.calls[0][1]

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(input).toHaveValue(''))
      expect(mockOnSendMessage).toHaveBeenLastCalledWith('Goal!', clientMessageId)
    })

    it("offers 'Send again' with the same id when delivery couldn't be confirmed", async () => {
      mockOnSendMessage.mockResolvedValueOnce('unconfirmed').mockResolvedValueOnce('acknowledged')
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Did this land?' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent("Couldn't confirm it was sent.")
      expect(alert).not.toHaveTextContent(/check/i)
      const clientMessageId = mockOnSendMessage.mock.calls[0][1]

      fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
      await waitFor(() => expect(input).toHaveValue(''))
      expect(mockOnSendMessage).toHaveBeenLastCalledWith('Did this land?', clientMessageId)
    })

    it('reuses the id when the unchanged draft is sent again, but not after an edit', async () => {
      mockOnSendMessage.mockReturnValue('not-sent')
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Same words' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await screen.findByRole('alert')
      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(mockOnSendMessage).toHaveBeenCalledTimes(2))
      await screen.findByRole('alert')
      fireEvent.change(input, { target: { value: 'Other words' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(mockOnSendMessage).toHaveBeenCalledTimes(3))
      const ids = mockOnSendMessage.mock.calls.map((call) => call[1])
      expect(ids[1]).toBe(ids[0])
      expect(ids[2]).not.toBe(ids[0])
    })

    it('clears the failure row when the draft changes', async () => {
      mockOnSendMessage.mockReturnValue('not-sent')
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Offline' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await screen.findByRole('alert')
      fireEvent.change(input, { target: { value: 'Offline!' } })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('grouping', () => {
    // Local noon, well clear of midnight, which ends a group
    const base = new Date(2026, 8, 27, 12, 0).getTime()
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(base)
    })
    afterEach(() => {
      vi.useRealTimers()
    })
    // A message sent this many seconds before now
    const sent = (id: string, username: string, secondsAgo: number, userId?: string): ChatMessage => ({
      messageId: id,
      username,
      userId,
      content: `Message ${id}`,
      timestamp: new Date(base - secondsAgo * 1000).toISOString(),
    })

    it('shows one name and one time for quick messages from one sender', () => {
      useChatStore.setState({
        messages: [sent('1', 'OtherUser', 20), sent('2', 'OtherUser', 10), sent('3', 'OtherUser', 0)],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getAllByText('OtherUser')).toHaveLength(1)
      expect(screen.getAllByText('just now')).toHaveLength(1)
    })

    it('starts a new group after a gap of more than 3 minutes', () => {
      useChatStore.setState({ messages: [sent('1', 'OtherUser', 200), sent('2', 'OtherUser', 0)] })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getAllByText('OtherUser')).toHaveLength(2)
    })

    it('keeps a gap of exactly 3 minutes in the group', () => {
      useChatStore.setState({ messages: [sent('1', 'OtherUser', 180), sent('2', 'OtherUser', 0)] })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getAllByText('OtherUser')).toHaveLength(1)
    })

    it('starts a new group when someone else speaks in between', () => {
      useChatStore.setState({
        messages: [sent('1', 'Alice', 20), sent('2', 'Bob', 10), sent('3', 'Alice', 0)],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getAllByText('Alice')).toHaveLength(2)
      expect(screen.getAllByText('Bob')).toHaveLength(1)
    })

    it('never merges two people who picked the same name', () => {
      useChatStore.setState({
        messages: [sent('1', 'Sam', 10, 'u_aaaaaaaaaaaaaaaa'), sent('2', 'Sam', 0, 'u_bbbbbbbbbbbbbbbb')],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getAllByText('Sam')).toHaveLength(2)
    })

    it('keeps one sender together across a rename', () => {
      useChatStore.setState({
        messages: [sent('1', 'Sam', 10, 'u_aaaaaaaaaaaaaaaa'), sent('2', 'Samuel', 0, 'u_aaaaaaaaaaaaaaaa')],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getByText('Sam')).toBeInTheDocument()
      expect(screen.queryByText('Samuel')).not.toBeInTheDocument()
    })

    it("names the sender again after the 'New' divider", () => {
      useChatStore.setState({
        messages: [sent('1', 'OtherUser', 20), sent('2', 'OtherUser', 10)],
        readMarker: base - 15_000,
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getAllByText('OtherUser')).toHaveLength(2)
      // Each side of the divider ends with its time
      expect(screen.getAllByText('just now')).toHaveLength(2)
    })
  })

  describe('day separators', () => {
    // Local times, so the days hold in any time zone
    const at = (day: number, hour: number, minute: number) => new Date(2026, 8, day, hour, minute)
    const sentAt = (id: string, username: string, when: Date): ChatMessage => ({
      messageId: id,
      username,
      content: `Message ${id}`,
      timestamp: when.toISOString(),
    })
    const daySeparators = () =>
      screen.getAllByRole('separator').filter((el) => el.getAttribute('aria-label') !== 'New messages')

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(at(27, 12, 0))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("puts 'Yesterday' and 'Today' before the first message of each day", () => {
      useChatStore.setState({
        messages: [
          sentAt('1', 'OtherUser', at(26, 22, 0)),
          sentAt('2', 'OtherUser', at(26, 22, 1)),
          sentAt('3', 'OtherUser', at(27, 9, 0)),
          sentAt('4', 'OtherUser', at(27, 11, 59)),
        ],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(daySeparators().map((el) => el.textContent)).toEqual(['Yesterday', 'Today'])

      const yesterday = screen.getByRole('separator', { name: 'Yesterday' })
      const today = screen.getByRole('separator', { name: 'Today' })
      const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      expect(follows(yesterday, screen.getByText('Message 1'))).toBe(true)
      expect(follows(screen.getByText('Message 2'), today)).toBe(true)
      expect(follows(today, screen.getByText('Message 3'))).toBe(true)
    })

    it('names the date for anything older than yesterday', () => {
      const older = at(24, 20, 0)
      useChatStore.setState({ messages: [sentAt('1', 'OtherUser', older)] })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const label = older.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
      expect(screen.getByRole('separator', { name: label })).toHaveTextContent(label)
    })

    it('splits a group at midnight', () => {
      useChatStore.setState({
        messages: [sentAt('1', 'OtherUser', at(26, 23, 59)), sentAt('2', 'OtherUser', at(27, 0, 1))],
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getAllByText('OtherUser')).toHaveLength(2)
    })

    it("turns 'Today' into 'Yesterday' once midnight passes with the panel open", () => {
      vi.setSystemTime(at(27, 23, 59))
      useChatStore.setState({ messages: [sentAt('1', 'OtherUser', at(27, 23, 0))] })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(screen.getByRole('separator', { name: 'Today' })).toBeInTheDocument()

      act(() => { vi.advanceTimersByTime(90_000) })
      expect(screen.queryByRole('separator', { name: 'Today' })).not.toBeInTheDocument()
      expect(screen.getByRole('separator', { name: 'Yesterday' })).toBeInTheDocument()
    })
  })

  describe('scroll position', () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    const originalMatchMedia = window.matchMedia

    beforeEach(() => {
      vi.useFakeTimers()
      scrollIntoView.mockClear()
    })

    afterEach(() => {
      vi.useRealTimers()
      window.matchMedia = originalMatchMedia
    })

    // jsdom has no layout: give the list a 1000px tall history in a 300px viewport
    const mockViewport = () => {
      const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
      if (!viewport) throw new Error('no scroll-area viewport')
      Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1000 })
      Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 300 })
      return viewport
    }
    const scrollTo = (viewport: HTMLElement, top: number) => {
      Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: top })
      fireEvent.scroll(viewport)
    }
    // Open over two messages, let the opening scroll run, and start at the bottom
    const openAtBottom = () => {
      useChatStore.setState({ messages: [createMessage('1', 'OtherUser'), createMessage('2', 'OtherUser')] })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      act(() => { vi.advanceTimersByTime(50) })
      const viewport = mockViewport()
      scrollTo(viewport, 700)
      scrollIntoView.mockClear()
      return viewport
    }
    // A message arrives, and any scroll it schedules has had time to run
    const receive = (id: string, username = 'OtherUser') => {
      act(() => { useChatStore.getState().addMessage(createMessage(id, username)) })
      act(() => { vi.advanceTimersByTime(100) })
    }

    it('follows a new message down while the reader is at the bottom', () => {
      openAtBottom()
      receive('3')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: /new message/ })).not.toBeInTheDocument()
    })

    it('holds the position when scrolled up and counts new messages in a pill', () => {
      const viewport = openAtBottom()
      scrollTo(viewport, 200)

      receive('3')
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: '1 new message' })).toBeInTheDocument()

      receive('4')
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: '2 new messages' })).toBeInTheDocument()
    })

    it('the pill scrolls down to the latest and goes away', () => {
      const viewport = openAtBottom()
      scrollTo(viewport, 200)
      receive('3')

      fireEvent.click(screen.getByRole('button', { name: '1 new message' }))
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: /new message/ })).not.toBeInTheDocument()

      // Back to following: the next message scrolls
      receive('4')
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
    })

    it('scrolling back to the bottom clears the pill', () => {
      const viewport = openAtBottom()
      scrollTo(viewport, 200)
      receive('3')
      // Within 80px of the bottom counts
      scrollTo(viewport, 650)
      expect(screen.queryByRole('button', { name: /new message/ })).not.toBeInTheDocument()
    })

    it('always scrolls to your own message, even when scrolled up', () => {
      const viewport = openAtBottom()
      scrollTo(viewport, 200)
      receive('3', 'TestUser')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: /new message/ })).not.toBeInTheDocument()
    })

    it('keeps following through a smooth scroll that is still on its way down', () => {
      const viewport = openAtBottom()
      receive('3')
      // The smooth scroll to message 3 is mid-way when message 4 arrives
      scrollTo(viewport, 710)
      Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1200 })
      scrollTo(viewport, 750)
      receive('4')
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('button', { name: /new message/ })).not.toBeInTheDocument()
    })

    it("opens on the 'New' divider when there is unread", () => {
      useChatStore.setState({
        messages: [
          { ...createMessage('1', 'OtherUser'), timestamp: '2026-09-26T20:00:01.000Z' },
          { ...createMessage('2', 'OtherUser'), timestamp: '2026-09-26T20:00:03.000Z' },
        ],
        readMarker: Date.parse('2026-09-26T20:00:02.000Z'),
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      act(() => { vi.advanceTimersByTime(50) })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('separator', { name: 'New messages' }))
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    })

    // Unread from someone else below the 'New' divider, in a viewport of the given height
    const openOnDivider = (scrollHeight: number) => {
      useChatStore.setState({
        messages: [
          { ...createMessage('1', 'OtherUser'), timestamp: '2026-09-26T20:00:01.000Z' },
          { ...createMessage('2', 'OtherUser'), timestamp: '2026-09-26T20:00:03.000Z' },
        ],
        readMarker: Date.parse('2026-09-26T20:00:02.000Z'),
      })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const viewport = mockViewport()
      Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: scrollHeight })
      Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 0 })
      // The opening scroll to the divider moves nothing and fires no scroll event
      act(() => { vi.advanceTimersByTime(50) })
      scrollIntoView.mockClear()
    }

    it("follows new messages after opening on the 'New' divider in a history that fits", () => {
      openOnDivider(200)
      receive('3')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: /new message/ })).not.toBeInTheDocument()
    })

    it("holds on the 'New' divider when the unread runs past the panel", () => {
      openOnDivider(1000)
      receive('3')
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: '1 new message' })).toBeInTheDocument()
    })

    it('opens at the bottom when nothing is unread', () => {
      useChatStore.setState({ messages: [createMessage('1', 'OtherUser')] })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      act(() => { vi.advanceTimersByTime(50) })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' })
    })

    it('goes back to the bottom when the name editor closes over the list', () => {
      useChatStore.setState({ me: { username: 'TestUser' } })
      openAtBottom()
      fireEvent.click(screen.getByRole('button', { name: 'Edit nickname' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      act(() => { vi.advanceTimersByTime(50) })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    })

    it('jumps instead of smooth-scrolling under reduced motion', () => {
      window.matchMedia = vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
      openAtBottom()
      receive('3')
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' })
    })
  })

  describe('variants', () => {
    it('docks as a complementary landmark named Chat that sits in the layout', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} variant="docked" />)
      const panel = screen.getByRole('complementary', { name: 'Chat' })
      expect(panel).toHaveAttribute('id', 'chat-panel')
      expect(panel).toHaveClass('relative', 'h-full', 'w-80', 'shrink-0', 'border-l', 'bg-card')
      expect(panel).not.toHaveClass('fixed')
      expect(panel).not.toHaveClass('absolute')
      expect(panel).not.toHaveClass('shadow-lg')
    })

    it('opens the tablet sheet over its container rather than the viewport', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} variant="sheet" />)
      const panel = screen.getByRole('complementary', { name: 'Chat' })
      expect(panel).toHaveAttribute('id', 'chat-panel')
      expect(panel).toHaveClass('absolute', 'inset-y-0', 'right-0', 'z-40', 'w-80', 'shadow-lg')
      expect(panel).not.toHaveClass('fixed')
    })

    it.each([
      ['overlay', ['fixed', 'top-0', 'right-0', 'h-full', 'w-80', 'z-50']],
      ['takeover', ['fixed', 'inset-0', 'z-50']],
    ] as const)('keeps the %s variant fixed to the viewport', (variant, classes) => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} variant={variant} />)
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
      const panel = document.getElementById('chat-panel')
      expect(panel).toContainElement(screen.getByRole('heading', { name: 'Chat' }))
      expect(panel).toHaveClass(...classes)
    })

    it('is the overlay drawer when no variant is given', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      expect(document.getElementById('chat-panel')).toHaveClass('fixed', 'right-0', 'w-80')
    })

    // Theater turns docked (desktop) or sheet (a narrow fine-pointer window)
    // into overlay. The panel must stay the same DOM, or the list would
    // remount at its oldest messages and focus would leave the composer
    it.each(['docked', 'sheet'] as const)('keeps its list, composer and focus when %s becomes overlay', (from) => {
      useChatStore.setState({ messages: [createMessage('1'), createMessage('2')] })
      const { rerender } = render(<ChatPanel onSendMessage={mockOnSendMessage} variant={from} />)
      const panel = document.getElementById('chat-panel')
      const viewport = document.querySelector('[data-radix-scroll-area-viewport]')
      const message = screen.getByText('Message 2')
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'half typed' } })
      input.focus()

      rerender(<ChatPanel onSendMessage={mockOnSendMessage} variant="overlay" />)

      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
      expect(document.getElementById('chat-panel')).toBe(panel)
      expect(panel).toHaveClass('fixed')
      expect(viewport).not.toBeNull()
      expect(document.querySelector('[data-radix-scroll-area-viewport]')).toBe(viewport)
      expect(screen.getByText('Message 2')).toBe(message)
      expect(screen.getByPlaceholderText('Type a message...')).toBe(input)
      expect(input).toHaveValue('half typed')
      expect(input).toHaveFocus()
    })
  })

  describe('composer emphasis', () => {
    it('keeps Send a ghost button until there is text, then fills it', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const send = screen.getByRole('button', { name: 'Send message' })
      expect(send).toHaveAttribute('data-variant', 'ghost')

      fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: '   ' } })
      expect(send).toHaveAttribute('data-variant', 'ghost')

      fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: 'Goal!' } })
      expect(send).toHaveAttribute('data-variant', 'default')
      expect(send).toHaveClass('bg-primary')
    })
  })

  describe('message log', () => {
    afterEach(() => vi.useRealTimers())

    it('is a polite log that announces additions', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const log = screen.getByRole('log', { name: 'Chat messages' })
      expect(log).toHaveAttribute('aria-live', 'polite')
      expect(log).toHaveAttribute('aria-relevant', 'additions')
      expect(log).not.toHaveAttribute('aria-busy')
    })

    it('stays live when a new message arrives', () => {
      useChatStore.setState({ messages: [createMessage('1')] })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      act(() => useChatStore.getState().addMessage(createMessage('2', 'Other')))

      expect(screen.getByText('Message 2')).toBeInTheDocument()
      expect(screen.getByRole('log')).not.toHaveAttribute('aria-busy')
    })

    it('is busy while a reconnect history replaces the list, then live again', () => {
      vi.useFakeTimers()
      useChatStore.setState({ messages: [createMessage('1')] })
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)

      act(() => useChatStore.getState().setMessages([createMessage('1'), createMessage('2'), createMessage('3')]))

      expect(screen.getByText('Message 3')).toBeInTheDocument()
      expect(screen.getByRole('log')).toHaveAttribute('aria-busy', 'true')

      act(() => { vi.advanceTimersByTime(250) })
      expect(screen.getByRole('log')).not.toHaveAttribute('aria-busy')
    })
  })

  describe('focus and dialog semantics', () => {
    afterEach(() => {
      document.querySelectorAll('[data-testid="opener"]').forEach((element) => element.remove())
    })

    const addOpener = () => {
      const opener = document.createElement('button')
      opener.dataset.testid = 'opener'
      document.body.appendChild(opener)
      opener.focus()
      return opener
    }

    it.each(['docked', 'sheet', 'overlay', 'takeover'] as const)('returns focus to the %s chat opener on close', (variant) => {
      useChatStore.setState({ isOpen: false })
      const opener = addOpener()
      render(<ChatPanel onSendMessage={mockOnSendMessage} variant={variant} />)

      act(() => useChatStore.setState({ isOpen: true }))
      screen.getByPlaceholderText('Type a message...').focus()
      act(() => useChatStore.setState({ isOpen: false }))

      expect(opener).toHaveFocus()
    })

    it('leaves focus alone on close when the viewer has moved it out of chat', () => {
      useChatStore.setState({ isOpen: false })
      addOpener()
      const elsewhere = document.createElement('input')
      elsewhere.dataset.testid = 'opener'
      document.body.appendChild(elsewhere)
      render(<ChatPanel onSendMessage={mockOnSendMessage} variant="docked" />)

      act(() => useChatStore.setState({ isOpen: true }))
      elsewhere.focus()
      act(() => useChatStore.setState({ isOpen: false }))

      expect(elsewhere).toHaveFocus()
    })

    it('makes the phone takeover a modal dialog named by its heading', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} variant="takeover" />)
      const dialog = screen.getByRole('dialog', { name: 'Chat' })
      expect(dialog).toHaveAttribute('id', 'chat-panel')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it.each(['docked', 'sheet', 'overlay'] as const)('keeps the %s panel non-modal', (variant) => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} variant={variant} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(document.getElementById('chat-panel')).not.toHaveAttribute('aria-modal')
    })

    it('keeps Tab inside the takeover, skipping the disabled Send button', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} variant="takeover" />)
      const close = screen.getByRole('button', { name: 'Close chat' })
      const gif = screen.getByRole('button', { name: 'Send GIF' })
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()

      gif.focus()
      expect(fireEvent.keyDown(gif, { key: 'Tab' })).toBe(false)
      expect(close).toHaveFocus()

      expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false)
      expect(gif).toHaveFocus()
    })

    // A phone rotating to portrait (or a window dragged narrow) turns an open
    // overlay into the takeover; the viewer mid-message keeps the composer
    it('keeps the composer focused when an open overlay becomes the takeover', () => {
      useChatStore.setState({ me: { username: 'TestUser' } })
      const { rerender } = render(<ChatPanel onSendMessage={mockOnSendMessage} variant="overlay" />)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'half typed' } })
      input.focus()

      rerender(<ChatPanel onSendMessage={mockOnSendMessage} variant="takeover" />)

      expect(screen.getByRole('dialog', { name: 'Chat' })).toContainElement(input)
      expect(input).toHaveValue('half typed')
      expect(input).toHaveFocus()
    })

    it('does not trap Tab in the docked panel', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} variant="docked" />)
      const gif = screen.getByRole('button', { name: 'Send GIF' })
      gif.focus()

      expect(fireEvent.keyDown(gif, { key: 'Tab' })).toBe(true)
      expect(gif).toHaveFocus()
    })
  })

  describe('iOS safe area', () => {
    it('keeps the full-screen phone panel clear of the status bar and home indicator', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} variant="takeover" />)
      const panel = screen.getByRole('heading', { name: 'Chat' }).closest('.fixed')
      expect(panel).toHaveClass('inset-0', 'pt-safe', 'pb-safe')
    })

    it('leaves the desktop side panel unpadded', () => {
      render(<ChatPanel onSendMessage={mockOnSendMessage} />)
      const panel = screen.getByRole('heading', { name: 'Chat' }).closest('.fixed')
      expect(panel).toHaveClass('w-80')
      expect(panel).not.toHaveClass('pt-safe')
      expect(panel).not.toHaveClass('pb-safe')
    })
  })
})
