import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErsatzTVVideoControls, ErsatzTVVideoControlsProps } from './ErsatzTVVideoControls'

// Mock Vidstack hooks
const mockRemote = {
  togglePaused: vi.fn(),
  changeVolume: vi.fn(),
  toggleMuted: vi.fn(),
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
    mockPaused = false
    mockVolume = 1
    mockMuted = false
    mockFullscreen = false

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
    it('shows muted icon when muted', () => {
      mockMuted = true
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /unmute/i })).toBeInTheDocument()
    })

    it('shows volume icon when not muted', () => {
      mockMuted = false
      render(<ErsatzTVVideoControls {...defaultProps} />)

      expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument()
    })

    it('calls remote.toggleMuted when mute button is clicked', () => {
      render(<ErsatzTVVideoControls {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: /mute/i }))

      expect(mockRemote.toggleMuted).toHaveBeenCalledTimes(1)
    })

    it('calls remote.changeVolume when slider is changed', () => {
      render(<ErsatzTVVideoControls {...defaultProps} />)

      const slider = screen.getByRole('slider', { name: /volume/i })
      fireEvent.change(slider, { target: { value: '0.5' } })

      expect(mockRemote.changeVolume).toHaveBeenCalledWith(0.5)
    })

    it('shows slider value as 0 when muted', () => {
      mockMuted = true
      mockVolume = 0.8
      render(<ErsatzTVVideoControls {...defaultProps} />)

      const slider = screen.getByRole('slider', { name: /volume/i })
      expect(slider).toHaveValue('0')
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
