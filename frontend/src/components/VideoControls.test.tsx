import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { VideoControls, VideoControlsProps } from './VideoControls'

// Mock the highlight feature hook - disabled by default for existing tests
vi.mock('@/hooks/useHighlightFeature', () => ({
  useHighlightFeature: () => ({ isEnabled: false, isLoading: false }),
}))

// Script volume detection (false on iOS/iPadOS Safari)
const volumeSupport = vi.hoisted(() => ({ canSet: true }))
vi.mock('@/hooks/useCanSetVolume', () => ({ useCanSetVolume: () => volumeSupport.canSet }))

// Mock video element
const createMockVideoRef = () => {
  const video = document.createElement('video')
  Object.defineProperty(video, 'paused', { value: true, writable: true })
  Object.defineProperty(video, 'volume', { value: 1, writable: true })
  Object.defineProperty(video, 'muted', { value: false, writable: true })
  return { current: video }
}

describe('VideoControls', () => {
  let mockVideoRef: ReturnType<typeof createMockVideoRef>
  let defaultProps: VideoControlsProps

  beforeEach(() => {
    volumeSupport.canSet = true
    mockVideoRef = createMockVideoRef()
    defaultProps = {
      videoRef: mockVideoRef as React.RefObject<HTMLVideoElement>,
      isPlaying: false,
      volume: 1,
      isMuted: false,
      isTheaterMode: false,
      isFullscreen: false,
      isVisible: true,
      onPlayPause: vi.fn(),
      onVolumeChange: vi.fn(),
      onMuteToggle: vi.fn(),
      onFullscreenToggle: vi.fn(),
      onTheaterModeToggle: vi.fn(),
    }
  })

  describe('Component Rendering', () => {
    it('renders all control buttons', () => {
      render(<VideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /theater/i })).toBeInTheDocument()
    })

    it('renders volume slider', () => {
      render(<VideoControls {...defaultProps} />)

      expect(screen.getByRole('slider', { name: /volume/i })).toBeInTheDocument()
    })

    it('renders control bar container', () => {
      render(<VideoControls {...defaultProps} />)

      const controlBar = screen.getByRole('toolbar')
      expect(controlBar).toBeInTheDocument()
      expect(controlBar).toHaveClass('video-controls')
    })
  })

  describe('Play/Pause Control', () => {
    it('shows pause icon when isPlaying is true', () => {
      render(<VideoControls {...defaultProps} isPlaying={true} />)

      expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument()
    })

    it('shows play icon when isPlaying is false', () => {
      render(<VideoControls {...defaultProps} isPlaying={false} />)

      expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
    })

    it('calls onPlayPause when play button is clicked', () => {
      render(<VideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /play/i }))

      expect(defaultProps.onPlayPause).toHaveBeenCalledTimes(1)
    })

    it('calls onPlayPause when pause button is clicked', () => {
      render(<VideoControls {...defaultProps} isPlaying={true} />)

      fireEvent.click(screen.getByRole('button', { name: /pause/i }))

      expect(defaultProps.onPlayPause).toHaveBeenCalledTimes(1)
    })
  })

  describe('Volume Controls', () => {
    it('shows muted icon when isMuted is true', () => {
      render(<VideoControls {...defaultProps} isMuted={true} />)

      expect(screen.getByRole('button', { name: /unmute/i })).toBeInTheDocument()
    })

    it('shows volume icon when isMuted is false', () => {
      render(<VideoControls {...defaultProps} isMuted={false} />)

      expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument()
    })

    it('calls onMuteToggle when mute button is clicked', () => {
      render(<VideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /mute/i }))

      expect(defaultProps.onMuteToggle).toHaveBeenCalledTimes(1)
    })

    it('calls onVolumeChange when slider is changed', () => {
      render(<VideoControls {...defaultProps} />)

      const slider = screen.getByRole('slider', { name: /volume/i })
      fireEvent.change(slider, { target: { value: '0.5' } })

      expect(defaultProps.onVolumeChange).toHaveBeenCalledWith(0.5)
    })

    it('shows slider value as 0 when muted', () => {
      render(<VideoControls {...defaultProps} isMuted={true} volume={0.8} />)

      const slider = screen.getByRole('slider', { name: /volume/i })
      expect(slider).toHaveValue('0')
    })
  })

  describe('Browsers that ignore script volume (iOS/iPadOS)', () => {
    it('hides the volume slider and keeps Mute', () => {
      volumeSupport.canSet = false
      render(<VideoControls {...defaultProps} />)

      expect(screen.queryByRole('slider', { name: /volume/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument()
    })

    it('shows the volume slider where volume can be set', () => {
      volumeSupport.canSet = true
      render(<VideoControls {...defaultProps} />)

      expect(screen.getByRole('slider', { name: /volume/i })).toBeInTheDocument()
    })
  })

  describe('Fullscreen Control', () => {
    it('calls onFullscreenToggle when fullscreen button is clicked', () => {
      render(<VideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /fullscreen/i }))

      expect(defaultProps.onFullscreenToggle).toHaveBeenCalledTimes(1)
    })
  })

  describe('Theater Mode Control', () => {
    it('calls onTheaterModeToggle when theater button is clicked', () => {
      render(<VideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /theater/i }))

      expect(defaultProps.onTheaterModeToggle).toHaveBeenCalledTimes(1)
    })

    it('shows exit theater mode label when in theater mode', () => {
      render(<VideoControls {...defaultProps} isTheaterMode={true} />)

      expect(screen.getByRole('button', { name: /exit theater/i })).toBeInTheDocument()
    })

    it('hides theater mode button when in fullscreen', () => {
      render(<VideoControls {...defaultProps} isFullscreen={true} />)

      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
    })

    it('shows theater mode button when not in fullscreen', () => {
      render(<VideoControls {...defaultProps} isFullscreen={false} />)

      expect(screen.getByRole('button', { name: /theater/i })).toBeInTheDocument()
    })

    it('hides theater mode button on mobile', () => {
      render(<VideoControls {...defaultProps} isMobile={true} />)

      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
    })
  })

  describe('TV browsers', () => {
    // webOS pointer mode can report pointer:coarse, so TV mode must win over isMobile
    it('renders Theater and Fullscreen on a TV that looks like a touch device', () => {
      render(<VideoControls {...defaultProps} isTVMode={true} isMobile={true} />)

      expect(screen.getByRole('button', { name: 'Theater mode' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
    })

    it('still hides the theater button in fullscreen on a TV', () => {
      render(<VideoControls {...defaultProps} isTVMode={true} isFullscreen={true} />)

      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
    })
  })

  describe('Control Bar Positioning', () => {
    it('has consistent bottom-4 position regardless of theater mode', () => {
      const { rerender } = render(<VideoControls {...defaultProps} isTheaterMode={false} />)

      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).toHaveClass('bottom-4')

      rerender(<VideoControls {...defaultProps} isTheaterMode={true} />)
      expect(toolbar).toHaveClass('bottom-4')
    })

    it('does not change position between theater and non-theater modes', () => {
      render(<VideoControls {...defaultProps} isTheaterMode={false} />)

      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).not.toHaveClass('bottom-12')
      expect(toolbar).not.toHaveClass('bottom-24')
    })
  })

  describe('Visibility', () => {
    it('is visible when isVisible is true', () => {
      render(<VideoControls {...defaultProps} isVisible={true} />)

      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).toHaveClass('opacity-100')
      expect(toolbar).not.toHaveClass('opacity-0')
    })

    it('is hidden when isVisible is false', () => {
      render(<VideoControls {...defaultProps} isVisible={false} />)

      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).toHaveClass('opacity-0')
      expect(toolbar).toHaveClass('pointer-events-none')
    })

    it('buttons are tabbable when visible', () => {
      render(<VideoControls {...defaultProps} isVisible={true} />)

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveAttribute('tabindex', '0')
      })

      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('tabindex', '0')
    })

    it('buttons are not tabbable when hidden', () => {
      render(<VideoControls {...defaultProps} isVisible={false} />)

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveAttribute('tabindex', '-1')
      })

      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('tabindex', '-1')
    })
  })

  describe('Hover Events', () => {
    it('calls onMouseEnter when mouse enters controls', () => {
      const onMouseEnter = vi.fn()
      render(<VideoControls {...defaultProps} onMouseEnter={onMouseEnter} />)

      const toolbar = screen.getByRole('toolbar')
      fireEvent.mouseEnter(toolbar)

      expect(onMouseEnter).toHaveBeenCalledTimes(1)
    })

    it('calls onMouseLeave when mouse leaves controls', () => {
      const onMouseLeave = vi.fn()
      render(<VideoControls {...defaultProps} onMouseLeave={onMouseLeave} />)

      const toolbar = screen.getByRole('toolbar')
      fireEvent.mouseLeave(toolbar)

      expect(onMouseLeave).toHaveBeenCalledTimes(1)
    })

    it('does not throw when hover handlers are not provided', () => {
      render(<VideoControls {...defaultProps} />)

      const toolbar = screen.getByRole('toolbar')

      // Should not throw
      expect(() => {
        fireEvent.mouseEnter(toolbar)
        fireEvent.mouseLeave(toolbar)
      }).not.toThrow()
    })
  })
})
