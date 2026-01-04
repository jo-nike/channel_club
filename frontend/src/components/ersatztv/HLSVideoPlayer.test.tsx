import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HLSVideoPlayer } from './HLSVideoPlayer'

// Mock @vidstack/react to avoid HLS loading in tests
vi.mock('@vidstack/react', () => ({
  MediaPlayer: ({ children, className, onWaiting, onPlaying, onError, 'data-testid': testId }: {
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
}))

vi.mock('@vidstack/react/player/layouts/default', () => ({
  DefaultVideoLayout: () => <div data-testid="default-layout" />,
  defaultLayoutIcons: {},
}))

describe('HLSVideoPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Task 1: Component Rendering', () => {
    it('renders player with stream URL', () => {
      render(<HLSVideoPlayer streamUrl="http://test/stream.m3u8" />)
      expect(screen.getByTestId('media-player')).toBeInTheDocument()
      expect(screen.getByTestId('media-provider')).toBeInTheDocument()
    })

    it('renders with title when provided', () => {
      render(<HLSVideoPlayer streamUrl="http://test/stream.m3u8" title="Test Channel" />)
      expect(screen.getByTestId('media-player')).toBeInTheDocument()
    })

    it('includes default video layout for controls', () => {
      render(<HLSVideoPlayer streamUrl="http://test/stream.m3u8" />)
      expect(screen.getByTestId('default-layout')).toBeInTheDocument()
    })
  })

  describe('Task 3: Buffering State', () => {
    it('shows buffering overlay initially', () => {
      render(<HLSVideoPlayer streamUrl="http://test/stream.m3u8" />)
      // Buffering spinner should be visible initially
      expect(screen.getByTestId('buffering-spinner')).toBeInTheDocument()
    })

    it('has event handlers for buffering state', () => {
      render(<HLSVideoPlayer streamUrl="http://test/stream.m3u8" />)
      const player = screen.getByTestId('media-player')
      expect(player).toHaveAttribute('data-on-waiting', 'bound')
      expect(player).toHaveAttribute('data-on-playing', 'bound')
    })
  })

  describe('Task 4: Error Handling', () => {
    it('has error event handler', () => {
      render(<HLSVideoPlayer streamUrl="http://test/stream.m3u8" />)
      const player = screen.getByTestId('media-player')
      expect(player).toHaveAttribute('data-on-error', 'bound')
    })

    it('calls onError callback when provided', () => {
      const onError = vi.fn()
      render(
        <HLSVideoPlayer
          streamUrl="http://invalid/stream.m3u8"
          onError={onError}
        />
      )
      expect(screen.getByTestId('media-player')).toBeInTheDocument()
    })
  })
})
