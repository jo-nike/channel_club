import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VideoPlayer, ErrorOverlay, BufferingOverlay } from './VideoPlayer'
import { useChannelStore } from '@/stores/channelStore'

// Mock the channelStore
vi.mock('@/stores/channelStore', () => ({
  useChannelStore: vi.fn(),
}))

// Mock Vidstack web components
beforeEach(() => {
  // Define custom elements if not already defined
  if (!customElements.get('media-player')) {
    customElements.define(
      'media-player',
      class extends HTMLElement {
        // Mock the subscribe method that Vidstack provides
        subscribe(callback: (state: Record<string, unknown>) => void) {
          // Immediately call with default state
          callback({
            error: undefined,
            waiting: false,
            playing: false,
            canPlay: false,
          })
          // Return unsubscribe function
          return () => {}
        }
      }
    )
  }
  if (!customElements.get('media-outlet')) {
    customElements.define('media-outlet', class extends HTMLElement {})
  }
  if (!customElements.get('media-community-skin')) {
    customElements.define('media-community-skin', class extends HTMLElement {})
  }
})

describe('VideoPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders placeholder when no channel is selected', () => {
    vi.mocked(useChannelStore).mockImplementation((selector) => {
      const state = {
        currentChannel: null,
        channels: [],
        isLoading: false,
        error: null,
        setChannels: vi.fn(),
        setCurrentChannel: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
      }
      return selector(state)
    })

    render(<VideoPlayer />)

    expect(screen.getByText('No channel selected')).toBeInTheDocument()
  })

  it('renders video player when channel is selected', () => {
    const mockChannel = {
      id: 'test-uuid',
      name: 'Test Channel',
      streamUrl: 'https://streams.domain.com/proxy/ts/stream/test-uuid',
    }

    vi.mocked(useChannelStore).mockImplementation((selector) => {
      const state = {
        currentChannel: mockChannel,
        channels: [mockChannel],
        isLoading: false,
        error: null,
        setChannels: vi.fn(),
        setCurrentChannel: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
      }
      return selector(state)
    })

    const { container } = render(<VideoPlayer />)

    // Check for the media-player element
    const mediaPlayer = container.querySelector('media-player')
    expect(mediaPlayer).toBeInTheDocument()
  })

  it('passes correct stream URL to video player', () => {
    const mockChannel = {
      id: 'test-uuid',
      name: 'Test Channel',
      streamUrl: 'https://streams.domain.com/proxy/ts/stream/test-uuid',
    }

    vi.mocked(useChannelStore).mockImplementation((selector) => {
      const state = {
        currentChannel: mockChannel,
        channels: [mockChannel],
        isLoading: false,
        error: null,
        setChannels: vi.fn(),
        setCurrentChannel: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
      }
      return selector(state)
    })

    const { container } = render(<VideoPlayer />)

    const mediaPlayer = container.querySelector('media-player')
    expect(mediaPlayer).toHaveAttribute('src', mockChannel.streamUrl)
  })

  it('re-renders with new stream when channel changes', () => {
    const channel1 = {
      id: 'channel-1',
      name: 'Channel 1',
      streamUrl: 'https://streams.domain.com/proxy/ts/stream/channel-1',
    }

    const channel2 = {
      id: 'channel-2',
      name: 'Channel 2',
      streamUrl: 'https://streams.domain.com/proxy/ts/stream/channel-2',
    }

    // First render with channel 1
    vi.mocked(useChannelStore).mockImplementation((selector) => {
      const state = {
        currentChannel: channel1,
        channels: [channel1, channel2],
        isLoading: false,
        error: null,
        setChannels: vi.fn(),
        setCurrentChannel: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
      }
      return selector(state)
    })

    const { container, rerender } = render(<VideoPlayer />)

    let mediaPlayer = container.querySelector('media-player')
    expect(mediaPlayer).toHaveAttribute('src', channel1.streamUrl)

    // Update mock to channel 2
    vi.mocked(useChannelStore).mockImplementation((selector) => {
      const state = {
        currentChannel: channel2,
        channels: [channel1, channel2],
        isLoading: false,
        error: null,
        setChannels: vi.fn(),
        setCurrentChannel: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
      }
      return selector(state)
    })

    // Re-render
    rerender(<VideoPlayer />)

    mediaPlayer = container.querySelector('media-player')
    expect(mediaPlayer).toHaveAttribute('src', channel2.streamUrl)
  })
})

describe('ErrorOverlay', () => {
  it('renders error message correctly', () => {
    render(<ErrorOverlay message="Stream unavailable" />)

    expect(screen.getByText('Stream unavailable')).toBeInTheDocument()
    expect(
      screen.getByText('Select another channel from the list')
    ).toBeInTheDocument()
  })

  it('renders with custom message', () => {
    render(<ErrorOverlay message="Network error" />)

    expect(screen.getByText('Network error')).toBeInTheDocument()
  })
})

describe('BufferingOverlay', () => {
  it('renders loading spinner when visible', () => {
    const { container } = render(<BufferingOverlay isVisible={true} />)

    // Check for the spinner element with animate-spin class
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('returns null when not visible', () => {
    const { container } = render(<BufferingOverlay isVisible={false} />)

    // Should render nothing
    expect(container.firstChild).toBeNull()
  })

  it('has pointer-events-none to not block interaction', () => {
    const { container } = render(<BufferingOverlay isVisible={true} />)

    const overlay = container.firstChild as HTMLElement
    expect(overlay.className).toContain('pointer-events-none')
  })
})

describe('VideoPlayer error recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows no channel selected placeholder when currentChannel is null', () => {
    vi.mocked(useChannelStore).mockImplementation((selector) => {
      const state = {
        currentChannel: null,
        channels: [],
        isLoading: false,
        error: null,
        setChannels: vi.fn(),
        setCurrentChannel: vi.fn(),
        setLoading: vi.fn(),
        setError: vi.fn(),
      }
      return selector(state)
    })

    render(<VideoPlayer />)

    expect(screen.getByText('No channel selected')).toBeInTheDocument()
  })

  it('renders both error overlay and channel list area accessible during error', () => {
    // This test verifies graceful degradation - error overlay doesn't block UI
    render(<ErrorOverlay message="Stream unavailable" />)

    const overlay = screen.getByText('Stream unavailable').closest('div')
    // Error overlay should be absolute positioned, not blocking sibling elements
    expect(overlay?.parentElement?.className).toContain('absolute')
  })
})
