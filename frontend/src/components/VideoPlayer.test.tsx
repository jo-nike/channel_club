import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/utils'
import { VideoPlayer, ErrorOverlay, BufferingOverlay } from './VideoPlayer'
import { useChannelStore } from '@/stores/channelStore'
import { useUIStore } from '@/stores/uiStore'

// Mock the channelStore
vi.mock('@/stores/channelStore', () => ({
  useChannelStore: vi.fn(),
}))

// Mock the uiStore
vi.mock('@/stores/uiStore', () => ({
  useUIStore: vi.fn(),
}))

// Mock mpegts.js
vi.mock('mpegts.js', () => ({
  default: {
    isSupported: () => true,
    createPlayer: () => ({
      attachMediaElement: vi.fn(),
      load: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn(),
    }),
    Events: {
      ERROR: 'error',
      LOADING_COMPLETE: 'loading_complete',
    },
  },
}))

// Mock HTMLVideoElement.play
beforeEach(() => {
  // Mock video element play method
  Object.defineProperty(HTMLVideoElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
})

describe('VideoPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Setup uiStore mock
    vi.mocked(useUIStore).mockImplementation((selector) => {
      const state = {
        isTheaterMode: false,
        setTheaterMode: vi.fn(),
        toggleTheaterMode: vi.fn(),
      }
      return selector(state)
    })
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

    expect(screen.getByText('No live TV channel currently selected')).toBeInTheDocument()
  })

  it('renders video element when channel is selected', () => {
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

    // Check for the video element
    const video = container.querySelector('video')
    expect(video).toBeInTheDocument()
  })

  it('renders video controls', () => {
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

    render(<VideoPlayer />)

    // Check for custom controls toolbar
    expect(screen.getByRole('toolbar', { name: /video controls/i })).toBeInTheDocument()
  })

  it('video element has no native controls attribute', () => {
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

    // Video should NOT have native controls
    const video = container.querySelector('video')
    expect(video).not.toHaveAttribute('controls')
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

    // Check for the film reel spinner element (animate-spin-slow from ProjectorBeamLoader)
    const spinner = container.querySelector('.animate-spin-slow')
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
    // Setup uiStore mock
    vi.mocked(useUIStore).mockImplementation((selector) => {
      const state = {
        isTheaterMode: false,
        setTheaterMode: vi.fn(),
        toggleTheaterMode: vi.fn(),
      }
      return selector(state)
    })
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

    expect(screen.getByText('No live TV channel currently selected')).toBeInTheDocument()
  })

  it('renders both error overlay and channel list area accessible during error', () => {
    // This test verifies graceful degradation - error overlay doesn't block UI
    render(<ErrorOverlay message="Stream unavailable" />)

    const overlay = screen.getByText('Stream unavailable').closest('div')
    // Error overlay should be absolute positioned, not blocking sibling elements
    expect(overlay?.parentElement?.className).toContain('absolute')
  })
})
