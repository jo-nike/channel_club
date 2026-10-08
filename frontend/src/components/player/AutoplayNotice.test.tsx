import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { AutoplayNotice } from './AutoplayNotice'
import { focusOverrides } from '@/test/focus'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'

// Script volume detection (false on iOS/iPadOS Safari)
const volumeSupport = vi.hoisted(() => ({ canSet: true }))
vi.mock('@/hooks/useCanSetVolume', () => ({ useCanSetVolume: () => volumeSupport.canSet }))

describe('AutoplayNotice', () => {
  beforeEach(() => {
    volumeSupport.canSet = true
    // NHL scores on, as the server's switch would have them for these tests
    useSettingsStore.setState({ serverFeatures: { chat: false, gif: false, nhl: true, sources: { dispatcharr: true, ersatztv: true } } })
    useUIStore.setState({ isNHLOverlayVisible: false })
  })

  it("'sound-off' says the sound is off, names the saved level and unmutes on tap", () => {
    const onUnmute = vi.fn()
    const onPlay = vi.fn()
    render(<AutoplayNotice mode="sound-off" volume={0.62} onUnmute={onUnmute} onPlay={onPlay} />)

    const pill = screen.getByRole('button', { name: /Sound is off/ })
    expect(pill).toHaveTextContent('Restore 62%')
    // Top-centre, clear of the bottom control bar and the rail's channel block
    expect(pill).toHaveClass('top-4', 'left-1/2', '-translate-x-1/2', 'z-30')
    expect(screen.queryByRole('button', { name: 'Start playback' })).not.toBeInTheDocument()

    fireEvent.click(pill)

    expect(onUnmute).toHaveBeenCalledTimes(1)
    expect(onPlay).not.toHaveBeenCalled()
  })

  it("'sound-off' moves under the player's info rail while the rail is up", () => {
    render(<AutoplayNotice mode="sound-off" volume={0.62} onUnmute={vi.fn()} onPlay={vi.fn()} belowRail />)

    const pill = screen.getByRole('button', { name: /Sound is off/ })
    expect(pill).toHaveClass('top-[calc(4.25rem+var(--player-inset-top,0px))]', 'left-1/2')
    expect(pill).not.toHaveClass('top-4')
  })

  it("'sound-off' moves below the NHL strip while it is open, under the rail or not", () => {
    useUIStore.setState({ isNHLOverlayVisible: true })
    const { rerender } = render(
      <AutoplayNotice mode="sound-off" volume={0.62} onUnmute={vi.fn()} onPlay={vi.fn()} belowRail />
    )

    const pill = screen.getByRole('button', { name: /Sound is off/ })
    expect(pill).toHaveClass('top-[calc(8.75rem+var(--player-inset-top,0px))]')
    expect(pill).not.toHaveClass('top-[calc(4.25rem+var(--player-inset-top,0px))]')

    rerender(<AutoplayNotice mode="sound-off" volume={0.62} onUnmute={vi.fn()} onPlay={vi.fn()} />)
    expect(pill).toHaveClass('top-[5rem]')
    expect(pill).not.toHaveClass('top-4')
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

  it.each(['sound-off', 'tap-to-play'] as const)(
    "'%s' marks keyboard focus with the over-video ring, which shows on any picture",
    (mode) => {
      render(<AutoplayNotice mode={mode} volume={1} onUnmute={vi.fn()} onPlay={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('focus-ring-media')
      expect(focusOverrides(button)).toEqual([])
    }
  )
})
