import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { ErsatzTVVideoControls, ErsatzTVVideoControlsProps } from './ErsatzTVVideoControls'
import { useAudioStore } from '@/stores/audioStore'

// Mock the highlight feature hook - disabled by default for existing tests
vi.mock('@/hooks/useHighlightFeature', () => ({
  useHighlightFeature: () => ({ isEnabled: false, isLoading: false }),
}))

// Script volume detection (false on iOS/iPadOS Safari)
const volumeSupport = vi.hoisted(() => ({ canSet: true }))
vi.mock('@/hooks/useCanSetVolume', () => ({ useCanSetVolume: () => volumeSupport.canSet }))

// Mock Vidstack hooks
const mockRemote = {
  togglePaused: vi.fn(),
  changeVolume: vi.fn(),
  toggleMuted: vi.fn(),
  mute: vi.fn(),
  unmute: vi.fn(),
  toggleFullscreen: vi.fn(),
}

let mockPaused = false
let mockVolume = 1
let mockMuted = false
let mockFullscreen = false

vi.mock('@vidstack/react', () => ({
  useMediaState: (prop: string) => {
    switch (prop) {
      case 'paused':
        return mockPaused
      case 'volume':
        return mockVolume
      case 'muted':
        return mockMuted
      case 'fullscreen':
        return mockFullscreen
      default:
        return null
    }
  },
  useMediaRemote: () => mockRemote,
}))

describe('ErsatzTVVideoControls', () => {
  let defaultProps: ErsatzTVVideoControlsProps

  beforeEach(() => {
    vi.clearAllMocks()
    volumeSupport.canSet = true
    mockPaused = false
    mockVolume = 1
    mockMuted = false
    mockFullscreen = false
    localStorage.clear()
    useAudioStore.setState({ volume: 1, muted: false })

    defaultProps = {
      isTheaterMode: false,
      isVisible: true,
      onTheaterModeToggle: vi.fn(),
    }
  })

  describe('Component Rendering', () => {
    it('renders all control buttons', () => {
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /theater/i })).toBeInTheDocument()
    })

    it('renders volume slider', () => {
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('slider', { name: /volume/i })).toBeInTheDocument()
    })

    it('renders control bar container', () => {
      render(<ErsatzTVVideoControls {...defaultProps} />)

      const controlBar = screen.getByRole('toolbar')
      expect(controlBar).toBeInTheDocument()
      expect(controlBar).toHaveClass('video-controls')
    })
  })

  describe('Play/Pause Control', () => {
    it('shows pause icon when playing', () => {
      mockPaused = false
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument()
    })

    it('shows play icon when paused', () => {
      mockPaused = true
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
    })

    it('calls remote.togglePaused when play button is clicked', () => {
      mockPaused = true
      render(<ErsatzTVVideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /play/i }))

      expect(mockRemote.togglePaused).toHaveBeenCalledTimes(1)
    })

    it('calls remote.togglePaused when pause button is clicked', () => {
      mockPaused = false
      render(<ErsatzTVVideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /pause/i }))

      expect(mockRemote.togglePaused).toHaveBeenCalledTimes(1)
    })
  })

  describe('Volume Controls', () => {
    it('shows muted icon when the saved state is muted', () => {
      useAudioStore.setState({ muted: true })
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /unmute/i })).toBeInTheDocument()
    })

    it('shows muted icon when only the element is muted', () => {
      mockMuted = true
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /unmute/i })).toBeInTheDocument()
    })

    it('shows volume icon when not muted', () => {
      mockMuted = false
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument()
    })

    it('saves mute to the audio store when mute button is clicked', () => {
      render(<ErsatzTVVideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /mute/i }))

      expect(useAudioStore.getState().muted).toBe(true)
      expect(mockRemote.toggleMuted).not.toHaveBeenCalled()
    })

    it('saves unmute and asks Vidstack to unmute an element-only mute', () => {
      mockMuted = true
      render(<ErsatzTVVideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /unmute/i }))

      expect(useAudioStore.getState().muted).toBe(false)
      expect(mockRemote.unmute).toHaveBeenCalledTimes(1)
    })

    it('saves the slider level to the audio store', () => {
      render(<ErsatzTVVideoControls {...defaultProps} />)

      const slider = screen.getByRole('slider', { name: /volume/i })
      fireEvent.change(slider, { target: { value: '0.5' } })

      expect(useAudioStore.getState().volume).toBe(0.5)
      expect(mockRemote.changeVolume).not.toHaveBeenCalled()
    })

    it('shows slider value as 0 when muted', () => {
      useAudioStore.setState({ volume: 0.8, muted: true })
      render(<ErsatzTVVideoControls {...defaultProps} />)

      const slider = screen.getByRole('slider', { name: /volume/i })
      expect(slider).toHaveValue('0')
    })

    it('shows the saved level, not Vidstack\'s placeholder 100% before can-play', () => {
      useAudioStore.setState({ volume: 0.3, muted: false })
      mockVolume = 1
      render(<ErsatzTVVideoControls {...defaultProps} />)

      const slider = screen.getByRole('slider', { name: /volume/i })
      expect(slider).toHaveValue('0.3')
    })
  })

  describe('Browsers that ignore script volume (iOS/iPadOS)', () => {
    it('hides the volume slider and keeps Mute', () => {
      volumeSupport.canSet = false
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.queryByRole('slider', { name: /volume/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument()
    })

    it('shows the volume slider where volume can be set', () => {
      volumeSupport.canSet = true
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('slider', { name: /volume/i })).toBeInTheDocument()
    })
  })

  describe('Fullscreen Control', () => {
    it('calls remote.toggleFullscreen when fullscreen button is clicked', () => {
      render(<ErsatzTVVideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /fullscreen/i }))

      expect(mockRemote.toggleFullscreen).toHaveBeenCalledTimes(1)
    })

    it('shows exit fullscreen label when in fullscreen', () => {
      mockFullscreen = true
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /exit fullscreen/i })).toBeInTheDocument()
    })
  })

  describe('Theater Mode Control', () => {
    it('calls onTheaterModeToggle when theater button is clicked', () => {
      render(<ErsatzTVVideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /theater/i }))

      expect(defaultProps.onTheaterModeToggle).toHaveBeenCalledTimes(1)
    })

    it('shows exit theater mode label when in theater mode', () => {
      render(<ErsatzTVVideoControls {...defaultProps} isTheaterMode={true} />)

      expect(screen.getByRole('button', { name: /exit theater/i })).toBeInTheDocument()
    })

    it('hides theater mode button on mobile', () => {
      render(<ErsatzTVVideoControls {...defaultProps} isMobile={true} />)

      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
    })

    it('hides theater mode button when in fullscreen', () => {
      mockFullscreen = true
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
    })

    it('shows theater mode button when not in fullscreen', () => {
      mockFullscreen = false
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /theater/i })).toBeInTheDocument()
    })
  })

  describe('Control Bar Positioning', () => {
    it('has consistent bottom-4 position regardless of theater mode', () => {
      const { rerender } = render(<ErsatzTVVideoControls {...defaultProps} isTheaterMode={false} />)

      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).toHaveClass('bottom-4')

      rerender(<ErsatzTVVideoControls {...defaultProps} isTheaterMode={true} />)
      expect(toolbar).toHaveClass('bottom-4')
    })

    it('does not change position between theater and non-theater modes', () => {
      render(<ErsatzTVVideoControls {...defaultProps} isTheaterMode={false} />)

      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).not.toHaveClass('bottom-12')
      expect(toolbar).not.toHaveClass('bottom-24')
    })
  })

  describe('Visibility', () => {
    it('is visible when isVisible is true', () => {
      render(<ErsatzTVVideoControls {...defaultProps} isVisible={true} />)

      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).toHaveClass('opacity-100')
      expect(toolbar).not.toHaveClass('opacity-0')
    })

    it('is hidden when isVisible is false', () => {
      render(<ErsatzTVVideoControls {...defaultProps} isVisible={false} />)

      const toolbar = screen.getByRole('toolbar')
      expect(toolbar).toHaveClass('opacity-0')
      expect(toolbar).toHaveClass('pointer-events-none')
    })

    it('buttons are tabbable when visible', () => {
      render(<ErsatzTVVideoControls {...defaultProps} isVisible={true} />)

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveAttribute('tabindex', '0')
      })

      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('tabindex', '0')
    })

    it('buttons are not tabbable when hidden', () => {
      render(<ErsatzTVVideoControls {...defaultProps} isVisible={false} />)

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
      render(<ErsatzTVVideoControls {...defaultProps} onMouseEnter={onMouseEnter} />)

      const toolbar = screen.getByRole('toolbar')
      fireEvent.mouseEnter(toolbar)

      expect(onMouseEnter).toHaveBeenCalledTimes(1)
    })

    it('calls onMouseLeave when mouse leaves controls', () => {
      const onMouseLeave = vi.fn()
      render(<ErsatzTVVideoControls {...defaultProps} onMouseLeave={onMouseLeave} />)

      const toolbar = screen.getByRole('toolbar')
      fireEvent.mouseLeave(toolbar)

      expect(onMouseLeave).toHaveBeenCalledTimes(1)
    })

    it('does not throw when hover handlers are not provided', () => {
      render(<ErsatzTVVideoControls {...defaultProps} />)

      const toolbar = screen.getByRole('toolbar')

      expect(() => {
        fireEvent.mouseEnter(toolbar)
        fireEvent.mouseLeave(toolbar)
      }).not.toThrow()
    })
  })
})
