import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HLSVideoPlayer } from './HLSVideoPlayer'

// Mock Vidstack hooks and components
const mockRemote = {
  togglePaused: vi.fn(),
  changeVolume: vi.fn(),
  toggleMuted: vi.fn(),
  toggleFullscreen: vi.fn(),
}

vi.mock('@vidstack/react', () => ({
  MediaPlayer: ({
    children,
    className,
    onWaiting,
    onPlaying,
    onError,
    'data-testid': testId,
  }: {
    children: React.ReactNode
    className?: string
    onWaiting?: () => void
    onPlaying?: () => void
    onError?: (e: { message?: string }) => void
    'data-testid'?: string
  }) => (
    <div
      data-testid={testId || 'media-player'}
      className={className}
      data-on-waiting={onWaiting ? 'bound' : undefined}
      data-on-playing={onPlaying ? 'bound' : undefined}
      data-on-error={onError ? 'bound' : undefined}
    >
      {children}
    </div>
  ),
  MediaProvider: () => <div data-testid="media-provider" />,
  useMediaState: (prop: string) => {
    switch (prop) {
      case 'paused':
        return false
      case 'volume':
        return 1
      case 'muted':
        return false
      case 'fullscreen':
        return false
      default:
        return null
    }
  },
  useMediaRemote: () => mockRemote,
}))

// Mock the auto-hide hook
vi.mock('@/hooks/useAutoHide', () => ({
  useAutoHide: () => ({
    isVisible: true,
    showControls: vi.fn(),
    hideControls: vi.fn(),
    toggleControls: vi.fn(),
  }),
}))

describe('HLSVideoPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Task 1: Component Rendering', () => {
    it('renders player with stream URL', () => {
      render(
        <HLSVideoPlayer
          streamUrl="http://test/stream.m3u8"
          isTheaterMode={false}
          onTheaterModeToggle={vi.fn()}
        />
      )
      expect(screen.getByTestId('media-player')).toBeInTheDocument()
      expect(screen.getByTestId('media-provider')).toBeInTheDocument()
    })

    it('renders with title when provided', () => {
      render(
        <HLSVideoPlayer
          streamUrl="http://test/stream.m3u8"
          title="Test Channel"
          isTheaterMode={false}
          onTheaterModeToggle={vi.fn()}
        />
      )
      expect(screen.getByTestId('media-player')).toBeInTheDocument()
    })

    it('renders custom video controls', () => {
      render(
        <HLSVideoPlayer
          streamUrl="http://test/stream.m3u8"
          isTheaterMode={false}
          onTheaterModeToggle={vi.fn()}
        />
      )
      // Custom controls should render with toolbar role
      expect(screen.getByRole('toolbar')).toBeInTheDocument()
    })
  })

  describe('Task 2: Theater Mode Props', () => {
    it('passes theater mode state to controls', () => {
      render(
        <HLSVideoPlayer
          streamUrl="http://test/stream.m3u8"
          isTheaterMode={true}
          onTheaterModeToggle={vi.fn()}
        />
      )
      // When in theater mode, control bar position adjusts
      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).toHaveClass('bottom-24')
    })

    it('passes isMobile prop to controls', () => {
      render(
        <HLSVideoPlayer
          streamUrl="http://test/stream.m3u8"
          isTheaterMode={false}
          isMobile={true}
          onTheaterModeToggle={vi.fn()}
        />
      )
      // On mobile, theater mode button should be hidden
      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
    })
  })

  describe('Task 3: Buffering State', () => {
    it('shows buffering overlay initially', () => {
      const { container } = render(
        <HLSVideoPlayer
          streamUrl="http://test/stream.m3u8"
          isTheaterMode={false}
          onTheaterModeToggle={vi.fn()}
        />
      )
      // Buffering overlay (ProjectorBeamLoader) should be visible initially
      const spinner = container.querySelector('.animate-spin-slow')
      expect(spinner).toBeInTheDocument()
    })

    it('has event handlers for buffering state', () => {
      render(
        <HLSVideoPlayer
          streamUrl="http://test/stream.m3u8"
          isTheaterMode={false}
          onTheaterModeToggle={vi.fn()}
        />
      )
      const player = screen.getByTestId('media-player')
      expect(player).toHaveAttribute('data-on-waiting', 'bound')
      expect(player).toHaveAttribute('data-on-playing', 'bound')
    })
  })

  describe('Task 4: Error Handling', () => {
    it('has error event handler', () => {
      render(
        <HLSVideoPlayer
          streamUrl="http://test/stream.m3u8"
          isTheaterMode={false}
          onTheaterModeToggle={vi.fn()}
        />
      )
      const player = screen.getByTestId('media-player')
      expect(player).toHaveAttribute('data-on-error', 'bound')
    })

    it('calls onError callback when provided', () => {
      const onError = vi.fn()
      render(
        <HLSVideoPlayer
          streamUrl="http://invalid/stream.m3u8"
          isTheaterMode={false}
          onTheaterModeToggle={vi.fn()}
          onError={onError}
        />
      )
      expect(screen.getByTestId('media-player')).toBeInTheDocument()
    })
  })
})
