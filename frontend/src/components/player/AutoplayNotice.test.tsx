import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { AutoplayNotice } from './AutoplayNotice'

// Script volume detection (false on iOS/iPadOS Safari)
const volumeSupport = vi.hoisted(() => ({ canSet: true }))
vi.mock('@/hooks/useCanSetVolume', () => ({ useCanSetVolume: () => volumeSupport.canSet }))

describe('AutoplayNotice', () => {
  beforeEach(() => {
    volumeSupport.canSet = true
  })

  it("'sound-off' says the sound is off, names the saved level and unmutes on tap", () => {
    const onUnmute = vi.fn()
    const onPlay = vi.fn()
    render(<AutoplayNotice mode="sound-off" volume={0.62} onUnmute={onUnmute} onPlay={onPlay} />)

    const pill = screen.getByRole('button', { name: /Sound is off/ })
    expect(pill).toHaveTextContent('Restore 62%')
    // Top-left, clear of the bottom control bar
    expect(pill).toHaveClass('top-4', 'left-4', 'z-30')
    expect(screen.queryByRole('button', { name: 'Start playback' })).not.toBeInTheDocument()

    fireEvent.click(pill)

    expect(onUnmute).toHaveBeenCalledTimes(1)
    expect(onPlay).not.toHaveBeenCalled()
  })

  it("'sound-off' says Turn sound on when the saved level is 0%", () => {
    render(<AutoplayNotice mode="sound-off" volume={0.004} onUnmute={vi.fn()} onPlay={vi.fn()} />)

    const pill = screen.getByRole('button', { name: /Sound is off/ })
    expect(pill).toHaveTextContent('Turn sound on')
    expect(pill).not.toHaveTextContent('Restore')
  })

  it("'sound-off' says Turn sound on where the browser ignores script volume (iOS)", () => {
    volumeSupport.canSet = false
    render(<AutoplayNotice mode="sound-off" volume={0.62} onUnmute={vi.fn()} onPlay={vi.fn()} />)

    const pill = screen.getByRole('button', { name: /Sound is off/ })
    expect(pill).toHaveTextContent('Turn sound on')
    expect(pill).not.toHaveTextContent('62%')
  })

  it("'tap-to-play' is a centre Play button that starts playback", () => {
    const onUnmute = vi.fn()
    const onPlay = vi.fn()
    render(<AutoplayNotice mode="tap-to-play" volume={0.62} onUnmute={onUnmute} onPlay={onPlay} />)

    const button = screen.getByRole('button', { name: 'Start playback' })
    expect(button).toHaveClass('top-1/2', 'left-1/2', 'z-30')
    expect(screen.queryByText(/Sound is off/)).not.toBeInTheDocument()

    fireEvent.click(button)

    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(onUnmute).not.toHaveBeenCalled()
  })

  it.each(['sound-off', 'tap-to-play'] as const)(
    "'%s' counts as a player control, so tapping it never toggles the control bar",
    (mode) => {
      render(<AutoplayNotice mode={mode} volume={1} onUnmute={vi.fn()} onPlay={vi.fn()} />)

      expect(screen.getByRole('button')).toHaveClass('video-controls')
    }
  )
})
