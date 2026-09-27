import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/utils'
import { CastErrorBanner, CastingCard } from './CastingCard'
import { PlayerShellContext, type PlayerShell } from './PlayerShellContext'
import { INITIAL_CAST_STATE, useCastStore } from '@/stores/castStore'
import { useAudioStore } from '@/stores/audioStore'
import { setReceiverVolume, stopCasting, toggleReceiverMute } from '@/hooks/useChromecast'

vi.mock('@/hooks/useChromecast', () => ({
  stopCasting: vi.fn(() => Promise.resolve()),
  setReceiverVolume: vi.fn(),
  toggleReceiverMute: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(stopCasting).mockClear()
  vi.mocked(setReceiverVolume).mockClear()
  vi.mocked(toggleReceiverMute).mockClear()
  useCastStore.setState({
    ...INITIAL_CAST_STATE,
    isLoading: false,
    isAvailable: true,
    isConnected: true,
    isCasting: true,
    deviceName: 'Living Room',
    receiverVolume: 0.6,
  })
  useAudioStore.setState({ volume: 0.3, muted: false })
})

describe('CastingCard', () => {
  it('says where it is casting', () => {
    render(<CastingCard />)

    expect(screen.getByRole('region', { name: 'Casting to Living Room' })).toBeInTheDocument()
  })

  it('Stop casting stops the cast', () => {
    render(<CastingCard />)

    fireEvent.click(screen.getByRole('button', { name: 'Stop casting' }))

    expect(stopCasting).toHaveBeenCalledTimes(1)
  })

  it("the slider shows and sets the receiver's volume, never the saved one", () => {
    render(<CastingCard />)
    const slider = screen.getByRole('slider', { name: 'Chromecast volume' })
    expect(slider).toHaveValue('0.6')

    fireEvent.change(slider, { target: { value: '0.4' } })

    expect(setReceiverVolume).toHaveBeenCalledExactlyOnceWith(0.4)
    expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: false })
  })

  it('mutes and unmutes the receiver', () => {
    const { rerender } = render(<CastingCard />)

    fireEvent.click(screen.getByRole('button', { name: 'Mute Chromecast' }))
    expect(toggleReceiverMute).toHaveBeenCalledTimes(1)

    act(() => useCastStore.setState({ receiverMuted: true }))
    rerender(<CastingCard />)
    expect(screen.getByRole('button', { name: 'Unmute Chromecast' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Chromecast volume' })).toHaveClass('opacity-50')
    expect(useAudioStore.getState().muted).toBe(false)
  })
})

describe('CastErrorBanner', () => {
  const shellElement = document.createElement('div')
  const renderBanner = (isFullscreen: boolean) => {
    // Only what the banner reads
    const shell = { containerRef: { current: shellElement }, isFullscreen } as unknown as PlayerShell
    return render(
      <PlayerShellContext value={shell}>
        <CastErrorBanner />
      </PlayerShellContext>
    )
  }
  const setFullscreenElement = (element: Element | null) =>
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element })
  const report = (message: string) => act(() => useCastStore.getState().reportError(message))

  afterEach(() => {
    setFullscreenElement(null)
    vi.useRealTimers()
  })

  it('shows a failure that happens while the shell is fullscreen', () => {
    setFullscreenElement(shellElement)
    renderBanner(true)

    report('Living Room stopped playing')

    expect(screen.getByRole('alert')).toHaveTextContent('Living Room stopped playing')
  })

  it('says nothing outside fullscreen, where the cast button toasts', () => {
    renderBanner(false)

    report('Living Room stopped playing')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not replay a failure from before', () => {
    useCastStore.getState().reportError('Living Room stopped playing')
    setFullscreenElement(shellElement)
    renderBanner(true)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Dismiss closes it', () => {
    setFullscreenElement(shellElement)
    renderBanner(true)
    report('Living Room stopped playing')

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('goes away by itself', () => {
    vi.useFakeTimers()
    setFullscreenElement(shellElement)
    renderBanner(true)
    report('Living Room stopped playing')

    act(() => vi.advanceTimersByTime(7999))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
