import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { fireEvent, render, screen, waitFor } from '@/test/utils'
import { ChatMessage } from './ChatMessage'
import * as api from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Channel, ChatMessage as ChatMessageType } from '@/types'
import type { ThemeId } from '@/types/theme'
import { MEMBER_HUES, memberColor, memberHue } from '@/lib/memberColor'
import { contrast, mix } from '@/lib/color'
import { themes } from '@/lib/themes'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

vi.mock('@/services/api', () => ({
  fetchGroupedChannels: vi.fn(),
}))

// The switch itself (optimistic store update, request, toast on refusal) is useSetLiveChannel's
const mockSetLiveChannel = vi.fn<(channel: Channel) => Promise<boolean>>(async () => true)
const useSetLiveChannelOptions = vi.fn()
vi.mock('@/hooks/useSetLiveChannel', () => ({
  useSetLiveChannel: (options?: { tuneActor?: boolean }) => {
    useSetLiveChannelOptions(options)
    return mockSetLiveChannel
  },
}))

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
    const clock = new Date(NOW).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    expect(screen.queryByText('just now')).not.toBeInTheDocument()
    expect(screen.getByText(clock)).toBeInTheDocument()
  })

  it('writes the clock time without a leading zero, like the guide', () => {
    // Local time, so the hour is 1 PM in any timezone
    const sentAt = new Date(2026, 0, 8, 13, 28)
    const message = createMessage({ timestamp: sentAt.toISOString() })
    render(<ChatMessage message={message} now={sentAt.getTime() + 5 * 60_000} />)
    expect(screen.getByText(/^1:28\sPM$/)).toBeInTheDocument()
  })

  it('times a message from the now it is given, not the wall clock', () => {
    // The wall clock (fake timers) is at NOW; the shared tick hasn't reached it yet
    const message = createMessage({ timestamp: new Date(NOW - 90_000).toISOString() })
    render(<ChatMessage message={message} now={NOW - 60_000} />)
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  describe('within a group', () => {
    it('shows the name and time on a message standing alone', () => {
      render(<ChatMessage message={createMessage({ username: 'OtherUser' })} now={NOW} />)
      expect(screen.getByText('OtherUser')).toBeInTheDocument()
      expect(screen.getByText('just now')).toBeInTheDocument()
    })

    it('shows the name but not the time on the first bubble', () => {
      render(<ChatMessage message={createMessage({ username: 'OtherUser' })} now={NOW} isLastInGroup={false} />)
      expect(screen.getByText('OtherUser')).toBeInTheDocument()
      expect(screen.queryByText('just now')).not.toBeInTheDocument()
    })

    it('shows neither on a bubble in the middle', () => {
      render(
        <ChatMessage
          message={createMessage({ username: 'OtherUser' })}
          now={NOW}
          isFirstInGroup={false}
          isLastInGroup={false}
        />
      )
      expect(screen.queryByText('OtherUser')).not.toBeInTheDocument()
      expect(screen.queryByText('just now')).not.toBeInTheDocument()
    })

    it('shows the time but not the name on the last bubble', () => {
      render(<ChatMessage message={createMessage({ username: 'OtherUser' })} now={NOW} isFirstInGroup={false} />)
      expect(screen.queryByText('OtherUser')).not.toBeInTheDocument()
      expect(screen.getByText('just now')).toBeInTheDocument()
    })

    it('packs bubbles inside a group closer than between groups', () => {
      const { container, rerender } = render(<ChatMessage message={createMessage()} now={NOW} />)
      expect(container.firstChild).toHaveClass('pt-1.5', 'pb-1.5')
      rerender(<ChatMessage message={createMessage()} now={NOW} isFirstInGroup={false} isLastInGroup={false} />)
      expect(container.firstChild).toHaveClass('pt-0.5', 'pb-0.5')
    })
  })

  it('applies different styles for own vs other messages', () => {
    const { rerender } = render(<ChatMessage message={createMessage()} now={NOW} />)
    const otherMessage = screen.getByText('Hello world!').closest('div')
    expect(otherMessage).toHaveClass('bg-muted')

    rerender(<ChatMessage message={createMessage()} isOwn={true} now={NOW} />)
    const ownMessage = screen.getByText('Hello world!').closest('div')
    expect(ownMessage).not.toHaveClass('bg-muted')
  })

  describe('member colours', () => {
    // Ids whose hashes land on different hues
    const idsByHue = new Map<number, string>()
    for (let i = 0; idsByHue.size < MEMBER_HUES.length; i++) {
      const id = `u_${i.toString(16).padStart(16, '0')}`
      if (!idsByHue.has(memberHue(id))) idsByHue.set(memberHue(id), id)
    }
    const [samId, devId] = [...idsByHue.values()]

    /** The member colour (dark mode) in force where `element` sits. */
    const memberColorAt = (element: HTMLElement) =>
      (element.closest('[style*="--member-dark"]') as HTMLElement).style.getPropertyValue('--member-dark')

    it("writes other people's names in their colour", () => {
      const { rerender } = render(
        <ChatMessage message={createMessage({ username: 'Sam', userId: samId })} now={NOW} />
      )
      const sam = screen.getByText('Sam')
      expect(sam).toHaveClass('text-(--member)')
      expect(memberColorAt(sam)).toBe(memberColor(samId, 'dark'))

      rerender(<ChatMessage message={createMessage({ username: 'Dev', userId: devId })} now={NOW} />)
      const dev = screen.getByText('Dev')
      expect(memberColorAt(dev)).toBe(memberColor(devId, 'dark'))
      expect(memberColorAt(dev)).not.toBe(memberColor(samId, 'dark'))
    })

    it('keeps a colour through a rename, and falls back to the name without an id', () => {
      const { rerender } = render(
        <ChatMessage message={createMessage({ username: 'Sammy', userId: samId })} now={NOW} />
      )
      expect(memberColorAt(screen.getByText('Sammy'))).toBe(memberColor(samId, 'dark'))

      rerender(<ChatMessage message={createMessage({ username: 'Sam' })} now={NOW} />)
      expect(memberColorAt(screen.getByText('Sam'))).toBe(memberColor('Sam', 'dark'))
    })

    it('tints your own bubble with your colour instead of the primary', () => {
      render(
        <ChatMessage message={createMessage({ username: 'Me', userId: samId })} isOwn={true} now={NOW} />
      )
      const bubble = screen.getByText('Hello world!').closest('div') as HTMLElement
      expect(bubble).not.toHaveClass('bg-primary')
      expect(bubble).not.toHaveClass('text-primary-foreground')
      expect(bubble).toHaveClass('bg-member-surface', 'text-foreground')
      expect(memberColorAt(bubble)).toBe(memberColor(samId, 'dark'))
    })

    // lib/color mixes in OKLab, like the bubble's --color-member-surface
    it.each(Object.keys(themes) as ThemeId[])(
      'keeps text on your own bubble readable in %s for every colour',
      (themeId) => {
        const { mode, colors } = themes[themeId]
        for (const id of idsByHue.values()) {
          const bubble = mix(colors.card, memberColor(id, mode), 0.18)
          expect(contrast(colors.foreground, bubble)).toBeGreaterThanOrEqual(4.5)
        }
      }
    )

    it("puts a face on the first bubble of someone else's group only", () => {
      const message = createMessage({ username: 'Sam Lee', userId: samId })
      const { container, rerender } = render(<ChatMessage message={message} now={NOW} isLastInGroup={false} />)
      const avatar = container.querySelector('[aria-hidden="true"].rounded-full') as HTMLElement
      expect(avatar).toHaveTextContent(/^SL$/)
      expect(avatar.style.getPropertyValue('--member-dark')).toBe(memberColor(samId, 'dark'))

      rerender(<ChatMessage message={message} now={NOW} isFirstInGroup={false} />)
      expect(screen.queryByText('SL')).not.toBeInTheDocument()

      rerender(<ChatMessage message={message} isOwn={true} now={NOW} />)
      expect(screen.queryByText('SL')).not.toBeInTheDocument()
    })

    it('leaves the face to the written name for screen readers', () => {
      render(<ChatMessage message={createMessage({ username: 'Sam', userId: samId })} now={NOW} />)
      expect(screen.queryByRole('img', { name: 'Sam' })).not.toBeInTheDocument()
      expect(screen.getByText('Sam')).toBeInTheDocument()
    })
  })

  it('preserves whitespace in messages', () => {
    const content = 'Line 1\nLine 2'
    render(<ChatMessage message={createMessage({ content })} now={NOW} />)
    // Query by matching function for multiline content
    const messageEl = screen.getByText((_, element) => {
      return element?.tagName === 'P' && element.textContent === content
    })
    expect(messageEl).toHaveClass('whitespace-pre-wrap')
  })

  describe('Media URL rendering', () => {
    const GIF = 'https://media.giphy.com/media/abc/giphy.gif'

    it('renders GIF URLs as embedded images', () => {
      const content = `Check this out: ${GIF}`
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', GIF)
    })

    it('renders video URLs as embedded videos', () => {
      const content = 'Watch: https://i.giphy.com/media/abc/giphy.mp4'
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      const video = document.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute('src', 'https://i.giphy.com/media/abc/giphy.mp4')
    })

    it('renders mixed text and media correctly', () => {
      const content = `Before ${GIF} after`
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      // Should show the text parts
      expect(screen.getByText('Before')).toBeInTheDocument()
      expect(screen.getByText('after')).toBeInTheDocument()
      // Should show the image
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', GIF)
    })

    it('renders multiple media URLs in order', () => {
      const content =
        'First: https://media.giphy.com/1.gif second: https://media0.giphy.com/2.webp'
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      const images = screen.getAllByRole('img')
      expect(images).toHaveLength(2)
      expect(images[0]).toHaveAttribute('src', 'https://media.giphy.com/1.gif')
      expect(images[1]).toHaveAttribute('src', 'https://media0.giphy.com/2.webp')
    })

    it('does not alter messages without media URLs', () => {
      const content = 'Just plain text'
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      expect(screen.getByText('Just plain text')).toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(document.querySelector('video')).not.toBeInTheDocument()
    })

    it('offers media from another host as a link, never loading it', () => {
      const url = 'https://media.tenor.com/abc123/video.mp4'
      render(<ChatMessage message={createMessage({ content: `lol ${url}` })} now={NOW} />)
      const link = screen.getByRole('link', { name: url })
      expect(link).toHaveAttribute('href', url)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(document.querySelector('video')).not.toBeInTheDocument()
    })

    it('leaves an http address on the local network as plain text', () => {
      const content = 'http://192.168.1.1/apply.cgi?reboot=1&x=.png'
      render(<ChatMessage message={createMessage({ content })} now={NOW} />)
      expect(screen.getByText(content)).toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('embeds three GIFs and links the rest', () => {
      const urls = [1, 2, 3, 4, 5].map((n) => `https://media.giphy.com/media/${n}/giphy.gif`)
      render(<ChatMessage message={createMessage({ content: urls.join(' ') })} now={NOW} />)
      expect(screen.getAllByRole('img').map((img) => img.getAttribute('src'))).toEqual(
        urls.slice(0, 3)
      )
      expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(
        urls.slice(3)
      )
    })
  })

  describe('system lines', () => {
    const systemLine = (overrides: Partial<ChatMessageType> = {}) =>
      createMessage({
        username: 'Live TV',
        userId: '',
        kind: 'system',
        content: 'jon put on TSN 5',
        timestamp: new Date(NOW).toISOString(),
        ...overrides,
      })

    it('shows the sentence and its time as one line, without a sender, face or bubble', () => {
      const { container } = render(<ChatMessage message={systemLine()} now={NOW} />)
      expect(screen.getByText('jon put on TSN 5 · just now')).toBeInTheDocument()
      expect(screen.queryByText('Live TV')).not.toBeInTheDocument()
      expect(screen.queryByText('LT')).not.toBeInTheDocument()
      expect(container.querySelector('.rounded-lg')).toBeNull()
    })

    it('is centred between rules, in muted text', () => {
      const { container } = render(<ChatMessage message={systemLine()} now={NOW} />)
      const line = container.firstElementChild as HTMLElement
      expect(line).toHaveClass('text-muted-foreground')
      expect(screen.getByText(/jon put on/)).toHaveClass('text-center')
      expect(line.querySelectorAll('.h-px')).toHaveLength(2)
    })

    it('stays text: a link in a system line is not embedded', () => {
      render(<ChatMessage message={systemLine({ content: 'jon put on https://a.com/1.gif' })} now={NOW} />)
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('offers Watch only when given what to do, and calls it', () => {
      const onWatch = vi.fn()
      const { rerender } = render(<ChatMessage message={systemLine()} now={NOW} />)
      expect(screen.queryByRole('button', { name: 'Watch' })).not.toBeInTheDocument()

      rerender(<ChatMessage message={systemLine()} now={NOW} onWatch={onWatch} />)
      fireEvent.click(screen.getByRole('button', { name: 'Watch' }))
      expect(onWatch).toHaveBeenCalledTimes(1)
    })

    it('never offers Watch on a member message', () => {
      render(<ChatMessage message={createMessage()} now={NOW} onWatch={vi.fn()} />)
      expect(screen.queryByRole('button', { name: 'Watch' })).not.toBeInTheDocument()
    })
  })

  describe('channel chip', () => {
    const cartoons = { name: 'Cartoons', live: false, number: 2 }

    it("reads 'on 2 Cartoons · Join' beside the sender's name, and Join calls back", () => {
      const onJoin = vi.fn()
      const { container } = render(
        <ChatMessage message={createMessage({ username: 'maya' })} now={NOW} channel={{ ...cartoons, onJoin }} />
      )
      const chip = container.querySelector('[data-slot="message-channel"]') as HTMLElement
      expect(chip).toHaveTextContent('on 2 Cartoons · Join')

      fireEvent.click(screen.getByRole('button', { name: 'Join maya on Cartoons' }))
      expect(onJoin).toHaveBeenCalledTimes(1)
    })

    it('names the channel without Join when there is nothing to join', () => {
      const { container } = render(<ChatMessage message={createMessage()} now={NOW} channel={cartoons} />)
      expect(container.querySelector('[data-slot="message-channel"]')).toHaveTextContent('on 2 Cartoons')
      expect(screen.queryByRole('button', { name: /join/i })).not.toBeInTheDocument()
    })

    it('marks live TV with the LIVE pill instead of a number', () => {
      render(<ChatMessage message={createMessage()} now={NOW} channel={{ name: 'TSN 5', live: true }} />)
      expect(screen.getByTestId('live-pill')).toBeInTheDocument()
      expect(screen.getByText('TSN 5')).toBeInTheDocument()
    })

    it('heads the group only: later bubbles carry no chip', () => {
      const { container } = render(
        <ChatMessage message={createMessage()} now={NOW} channel={cartoons} isFirstInGroup={false} />
      )
      expect(container.querySelector('[data-slot="message-channel"]')).toBeNull()
    })

    it('shows on your own messages too, so you see what others see', () => {
      const { container } = render(<ChatMessage message={createMessage()} now={NOW} isOwn channel={cartoons} />)
      expect(container.querySelector('[data-slot="message-channel"]')).toHaveTextContent('on 2 Cartoons')
    })

    it('is absent without a channel', () => {
      const { container } = render(<ChatMessage message={createMessage()} now={NOW} />)
      expect(container.querySelector('[data-slot="message-channel"]')).toBeNull()
    })
  })

  describe('share card', () => {
    const share = (overrides: Partial<ChatMessageType> = {}) =>
      createMessage({
        username: 'maya',
        kind: 'share',
        content: 'Watching TSN 5 · CFL Football',
        channelId: '42',
        channelName: 'TSN 5',
        programme: 'CFL Football',
        view: 'live',
        ...overrides,
      })
    const tsn = { name: 'TSN 5', programme: 'CFL Football', live: true }

    it('shows what the sender is watching as a card instead of a bubble', () => {
      const { container } = render(<ChatMessage message={share()} now={NOW} channel={tsn} />)
      const card = container.querySelector('[data-slot="share-card"]') as HTMLElement
      expect(card).toHaveTextContent('Watching')
      expect(card).toHaveTextContent('TSN 5')
      expect(card).toHaveTextContent('CFL Football')
      expect(screen.getByTestId('live-pill')).toBeInTheDocument()
      // The card replaces the text, and has no chip of its own
      expect(screen.queryByText('Watching TSN 5 · CFL Football')).not.toBeInTheDocument()
      expect(container.querySelector('[data-slot="message-channel"]')).toBeNull()
      expect(screen.getByText('maya')).toBeInTheDocument()
    })

    it('has Watch to go there', () => {
      const onJoin = vi.fn()
      render(<ChatMessage message={share()} now={NOW} channel={{ ...tsn, onJoin }} />)

      fireEvent.click(screen.getByRole('button', { name: 'Watch TSN 5 with maya' }))
      expect(onJoin).toHaveBeenCalledTimes(1)
    })

    it('shows an ErsatzTV channel by its number, without Watch when there is nothing to do', () => {
      const { container } = render(
        <ChatMessage message={share()} now={NOW} channel={{ name: 'Cartoons', live: false, number: 2 }} />
      )
      expect(container.querySelector('[data-slot="share-card"]')).toHaveTextContent('2 Cartoons')
      expect(screen.queryByRole('button', { name: /watch/i })).not.toBeInTheDocument()
    })

    it("says 'You're watching' on your own card", () => {
      render(<ChatMessage message={share()} now={NOW} isOwn channel={tsn} />)
      expect(screen.getByText("You're watching")).toBeInTheDocument()
    })

    it('falls back to its text without a channel', () => {
      const { container } = render(<ChatMessage message={share()} now={NOW} />)
      expect(container.querySelector('[data-slot="share-card"]')).toBeNull()
      expect(screen.getByText('Watching TSN 5 · CFL Football')).toBeInTheDocument()
    })
  })
})

describe('ChatMessage suggestion card', () => {
  const tsn5: Channel = { id: '42', name: 'TSN 5', streamUrl: 'http://streams/42.ts', guideId: 'tsn5' }
  const cbc: Channel = { id: '7', name: 'CBC', streamUrl: 'http://streams/7.ts', guideId: 'cbc' }
  const suggestion = (overrides: Partial<ChatMessageType> = {}) =>
    createMessage({
      username: 'maya',
      kind: 'suggestion',
      content: 'Suggests putting TSN 5 on live TV',
      channelId: '42',
      channelName: 'TSN 5',
      programme: null,
      view: null,
      ...overrides,
    })
  const putItOn = () => screen.queryByRole('button', { name: 'Put TSN 5 on live TV' })

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ role: 'admin', username: 'jon' })
    useSettingsStore.setState({ userChannelSelection: false })
    useChannelStore.setState({ currentChannel: cbc })
    vi.mocked(api.fetchGroupedChannels).mockResolvedValue({
      groups: [{ id: 1, name: 'Sports', channelCount: 1, channels: [tsn5] }],
      ungrouped: [cbc],
    })
  })

  it('shows the channel suggested as a card instead of a bubble, with no chip', () => {
    const { container } = render(
      <ChatMessage message={suggestion()} now={Date.now()} channel={{ name: 'Cartoons', live: false, number: 2 }} />
    )

    const card = container.querySelector('[data-slot="suggestion-card"]') as HTMLElement
    expect(card).toHaveTextContent('Suggests for live TV')
    expect(card).toHaveTextContent('TSN 5')
    expect(screen.queryByText('Suggests putting TSN 5 on live TV')).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="message-channel"]')).toBeNull()
    expect(screen.getByText('maya')).toBeInTheDocument()
  })

  it('puts the catalogue channel on live TV when an admin accepts it, without tuning them', async () => {
    render(<ChatMessage message={suggestion()} now={Date.now()} />)

    fireEvent.click(putItOn()!)

    await waitFor(() => expect(mockSetLiveChannel).toHaveBeenCalledWith(tsn5))
    expect(mockSetLiveChannel).toHaveBeenCalledTimes(1)
    expect(useSetLiveChannelOptions).not.toHaveBeenCalledWith({ tuneActor: true })
    await waitFor(() => expect(putItOn()).toBeEnabled())
  })

  it('offers Put it on to a viewer the admin allows to change live TV', () => {
    useAuthStore.setState({ role: 'viewer', username: 'sam' })
    useSettingsStore.setState({ userChannelSelection: true })
    render(<ChatMessage message={suggestion()} now={Date.now()} />)

    expect(putItOn()).toBeInTheDocument()
  })

  it('offers nothing to act on to a viewer who cannot change live TV', () => {
    useAuthStore.setState({ role: 'viewer', username: 'sam' })
    const { container } = render(<ChatMessage message={suggestion()} now={Date.now()} />)

    expect(container.querySelector('[data-slot="suggestion-card"]')).toHaveTextContent('TSN 5')
    expect(putItOn()).not.toBeInTheDocument()
  })

  it("says 'You suggested' on your own card", () => {
    useAuthStore.setState({ role: 'viewer', username: 'sam' })
    render(<ChatMessage message={suggestion()} now={Date.now()} isOwn />)

    expect(screen.getByText('You suggested for live TV')).toBeInTheDocument()
  })

  it('says the channel is on live TV once it is, instead of offering it', () => {
    useChannelStore.setState({ currentChannel: tsn5 })
    render(<ChatMessage message={suggestion()} now={Date.now()} />)

    expect(screen.getByText('On live TV now')).toBeInTheDocument()
    expect(putItOn()).not.toBeInTheDocument()
  })

  it('says so when the channel has left the catalogue, and switches nothing', async () => {
    vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce({ groups: [], ungrouped: [cbc] })
    render(<ChatMessage message={suggestion()} now={Date.now()} />)

    fireEvent.click(putItOn()!)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not put TSN 5 on', { description: "It's no longer in the channel list" })
    )
    expect(mockSetLiveChannel).not.toHaveBeenCalled()
  })

  it('says so when the catalogue cannot load', async () => {
    vi.mocked(api.fetchGroupedChannels).mockRejectedValueOnce(new Error('Channel service unavailable'))
    render(<ChatMessage message={suggestion()} now={Date.now()} />)

    fireEvent.click(putItOn()!)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not put TSN 5 on', { description: 'Please try again' })
    )
    expect(mockSetLiveChannel).not.toHaveBeenCalled()
  })

  it('falls back to its text without a channel', () => {
    const { container } = render(
      <ChatMessage message={suggestion({ channelId: null, channelName: null })} now={Date.now()} />
    )

    expect(container.querySelector('[data-slot="suggestion-card"]')).toBeNull()
    expect(screen.getByText('Suggests putting TSN 5 on live TV')).toBeInTheDocument()
  })
})
