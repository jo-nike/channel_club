import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@/test/utils'
import { toast } from 'sonner'
import { CastButton } from './CastButton'
import { INITIAL_CAST_STATE, useCastStore } from '@/stores/castStore'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

// The hook's state is the cast store's; the SDK is not needed here
vi.mock('@/hooks/useChromecast', async () => {
  const { useCastStore } = await import('@/stores/castStore')
  return {
    useChromecast: () => ({
      ...useCastStore(),
      startCasting: vi.fn(),
      stopCasting: vi.fn(),
      requestSession: vi.fn(),
      castTestStream: vi.fn(),
    }),
  }
})

const renderButton = () =>
  render(<CastButton channelId="7" streamType="mpegts" channelName="TSN" isVisible />)

const report = (message: string) => act(() => useCastStore.getState().reportError(message))

const setFullscreenElement = (element: Element | null) =>
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element })

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
  useCastStore.setState({ ...INITIAL_CAST_STATE, isLoading: false, isAvailable: true })
})

afterEach(() => setFullscreenElement(null))

describe('CastButton copy', () => {
  it('says where it is casting and what a click does, with no player state', () => {
    useCastStore.setState({ isConnected: true, isCasting: true, deviceName: 'Living Room', playerState: 'PLAYING' })
    renderButton()

    const button = screen.getByRole('button', { name: 'Casting to Living Room · click to stop' })
    expect(button.getAttribute('aria-label')).not.toMatch(/\[|PLAYING/)
  })

  it('says which device it is connected to when not casting', () => {
    useCastStore.setState({ isConnected: true, deviceName: 'Living Room' })
    renderButton()

    expect(screen.getByRole('button', { name: 'Connected to Living Room · click to cast' })).toBeInTheDocument()
  })

  it('keeps naming its action after a failure', () => {
    useCastStore.setState({ isConnected: true, deviceName: 'Living Room' })
    renderButton()
    report("Couldn't start casting. Try again.")

    expect(screen.getByRole('button', { name: 'Connected to Living Room · click to cast' })).toBeInTheDocument()
  })

  it('stays hidden while the cast feature is being checked', () => {
    useCastStore.setState({ isLoading: true })
    renderButton()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('CastButton failures', () => {
  it('shows a new failure as a toast', () => {
    renderButton()
    report("Couldn't connect to the Chromecast")

    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Couldn't connect to the Chromecast")
  })

  it('shows the same failure again when it happens again', () => {
    renderButton()
    report("Couldn't connect to the Chromecast")
    report("Couldn't connect to the Chromecast")

    expect(toast.error).toHaveBeenCalledTimes(2)
  })

  it('does not replay a failure from before it mounted', () => {
    useCastStore.getState().reportError("Couldn't connect to the Chromecast")
    renderButton()

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('no toast while fullscreen, where the player shows a banner instead', () => {
    renderButton()
    setFullscreenElement(document.body)
    report('Living Room stopped playing')

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('no toast when the failure is cleared', () => {
    useCastStore.getState().reportError("Couldn't connect to the Chromecast")
    renderButton()
    act(() => useCastStore.setState({ lastError: null }))

    expect(toast.error).not.toHaveBeenCalled()
  })
})
