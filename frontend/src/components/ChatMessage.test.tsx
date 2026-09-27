import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@/test/utils'
import { ChatMessage } from './ChatMessage'
import type { ChatMessage as ChatMessageType } from '@/types'

const createMessage = (
  overrides: Partial<ChatMessageType> = {}
): ChatMessageType => ({
  messageId: 'msg-1',
  username: 'TestUser',
  content: 'Hello world!',
  timestamp: new Date().toISOString(),
  ...overrides,
})

const NOW = new Date('2026-01-08T12:00:00Z').getTime()

describe('ChatMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders message content', () => {
    render(<ChatMessage message={createMessage({ content: 'Hello world!' })} now={NOW} />)
    expect(screen.getByText('Hello world!')).toBeInTheDocument()
  })

  it('shows username for non-own messages', () => {
    render(<ChatMessage message={createMessage({ username: 'OtherUser' })} now={NOW} />)
    expect(screen.getByText('OtherUser')).toBeInTheDocument()
  })

  it('hides username for own messages', () => {
    render(
      <ChatMessage
        message={createMessage({ username: 'MyUser' })}
        isOwn={true}
        now={NOW}
      />
    )
    expect(screen.queryByText('MyUser')).not.toBeInTheDocument()
  })

  it('shows "just now" for recent messages', () => {
    const now = new Date('2026-01-08T12:00:00Z')
    const message = createMessage({ timestamp: now.toISOString() })
    render(<ChatMessage message={message} now={NOW} />)
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('shows formatted time for older messages', () => {
    // Message from 5 minutes ago
    const fiveMinutesAgo = new Date('2026-01-08T11:55:00Z')
    const message = createMessage({ timestamp: fiveMinutesAgo.toISOString() })
    render(<ChatMessage message={message} now={NOW} />)
    // Time should be formatted (depends on locale, but should contain digits)
    expect(screen.queryByText('just now')).not.toBeInTheDocument()
  })

  it("moves from 'just now' to a clock time once the shared clock is a minute on", () => {
    const message = createMessage({ timestamp: new Date(NOW).toISOString() })
    const { rerender } = render(<ChatMessage message={message} now={NOW} />)
    expect(screen.getByText('just now')).toBeInTheDocument()

    rerender(<ChatMessage message={message} now={NOW + 60_000} />)
    const clock = new Date(NOW).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    expect(screen.queryByText('just now')).not.toBeInTheDocument()
    expect(screen.getByText(clock)).toBeInTheDocument()
  })

  it('times a message from the now it is given, not the wall clock', () => {
    // The wall clock (fake timers) is at NOW; the shared tick hasn't reached it yet
    const message = createMessage({ timestamp: new Date(NOW - 90_000).toISOString() })
    render(<ChatMessage message={message} now={NOW - 60_000} />)
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('applies different styles for own vs other messages', () => {
    const { rerender } = render(<ChatMessage message={createMessage()} now={NOW} />)
    const otherMessage = screen.getByText('Hello world!').closest('div')
    expect(otherMessage).toHaveClass('bg-muted')

    rerender(<ChatMessage message={createMessage()} isOwn={true} now={NOW} />)
    const ownMessage = screen.getByText('Hello world!').closest('div')
    expect(ownMessage).toHaveClass('bg-primary')
  })

  it('preserves whitespace in messages', () => {
    const content = 'Line 1\nLine 2'
    render(<ChatMessage message={createMessage({ content })} now={NOW} />)
    // Query by matching function for multiline content
    const messageEl = screen.getByText((_, element) => {
      return element?.textContent === content
    })
    expect(messageEl).toHaveClass('whitespace-pre-wrap')
  })

  describe('Media URL rendering', () => {
    it('renders GIF URLs as embedded images', () => {
      const content = 'Check this out: https://example.com/funny.gif'
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'https://example.com/funny.gif')
    })

    it('renders video URLs as embedded videos', () => {
      const content = 'Watch: https://example.com/clip.mp4'
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      const video = document.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute('src', 'https://example.com/clip.mp4')
    })

    it('renders mixed text and media correctly', () => {
      const content = 'Before https://example.com/test.gif after'
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      // Should show the text parts
      expect(screen.getByText('Before')).toBeInTheDocument()
      expect(screen.getByText('after')).toBeInTheDocument()
      // Should show the image
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'https://example.com/test.gif')
    })

    it('renders multiple media URLs in order', () => {
      const content =
        'First: https://a.com/1.gif second: https://b.com/2.png'
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      const images = screen.getAllByRole('img')
      expect(images).toHaveLength(2)
      expect(images[0]).toHaveAttribute('src', 'https://a.com/1.gif')
      expect(images[1]).toHaveAttribute('src', 'https://b.com/2.png')
    })

    it('does not alter messages without media URLs', () => {
      const content = 'Just plain text'
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      expect(screen.getByText('Just plain text')).toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(document.querySelector('video')).not.toBeInTheDocument()
    })

    it('converts Imgur gifv to mp4', () => {
      const content = 'https://i.imgur.com/abc123.gifv'
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      const video = document.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute('src', 'https://i.imgur.com/abc123.mp4')
    })
  })
})
