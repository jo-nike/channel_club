import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode, Ref } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@/test/utils'
import { DualModeVideoPlayer } from './DualModeVideoPlayer'
import { useAudioStore } from '@/stores/audioStore'
import { useFilterStore } from '@/stores/filterStore'
import type { UnifiedChannel } from '@/types'

// ----------------------------------------------------------------------------
// Harness: both engines are mocked. mpegts.js gets a stub player; Vidstack's
// MediaPlayer records its props and renders a focusable data-media-player div.
// ----------------------------------------------------------------------------

vi.mock('mpegts.js', () => ({
  default: {
    isSupported: () => true,
    createPlayer: () => ({ attachMediaElement: vi.fn(), load: vi.fn(), on: vi.fn(), destroy: vi.fn() }),
    Events: { ERROR: 'error', LOADING_COMPLETE: 'loading_complete' },
  },
}))

type MediaPlayerProps = {
  children?: ReactNode
  ref?: Ref<unknown>
  volume?: number
  muted?: boolean
  keyDisabled?: boolean
  onError?: () => void
  onPlaying?: () => void
  onAutoPlayFail?: (detail: { muted: boolean; error: Error }) => void
  onVolumeChange?: (detail: { volume: number; muted: boolean }) => void
}

const vidstack = vi.hoisted(() => {
  const remote = {
    togglePaused: vi.fn(),
    changeVolume: vi.fn(),
    toggleMuted: vi.fn(),
    mute: vi.fn(),
    unmute: vi.fn(),
    toggleFullscreen: vi.fn(),
  }
  const harness = {
    mediaPlayer: vi.fn<(props: Record<string, unknown>) => void>(),
    mounted: vi.fn(),
    // Vidstack reports a placeholder volume of 1 until can-play
    state: { paused: false, volume: 1, muted: false, fullscreen: false } as Record<string, unknown>,
    remote,
    // What the MediaPlayer ref exposes
    player: {
      play: vi.fn<() => Promise<void>>(),
      remoteControl: remote,
      get state() {
        return harness.state
      },
    },
  }
  return harness
})

vi.mock('@vidstack/react', async () => {
  const { useEffect, useImperativeHandle } = await import('react')
  return {
    MediaPlayer: ({ children, ref, ...props }: MediaPlayerProps) => {
      vidstack.mediaPlayer(props)
      useImperativeHandle(ref, () => vidstack.player)
      useEffect(() => vidstack.mounted(), [])
      return (
        <div data-media-player="" tabIndex={0}>
          {children}
        </div>
      )
    },
    MediaProvider: () => null,
    useMediaState: (prop: string) => vidstack.state[prop] ?? null,
    useMediaRemote: () => vidstack.remote,
  }
})

const highlight = vi.hoisted(() => ({
  enabled: false,
  modal: vi.fn<(props: { acquirePreviewAudio?: () => () => void }) => void>(),
}))
vi.mock('@/hooks/useHighlightFeature', () => ({
  useHighlightFeature: () => ({ isEnabled: highlight.enabled, isLoading: false }),
}))
vi.mock('@/hooks/useHighlightStatus', () => ({ useHighlightStatus: () => ({}) }))
vi.mock('@/components/HighlightButton', () => ({ HighlightButton: () => null }))
vi.mock('@/components/HighlightModal', () => ({
  HighlightModal: (props: { acquirePreviewAudio?: () => () => void }) => {
    highlight.modal(props)
    return null
  },
}))
vi.mock('@/components/CastButton', () => ({ CastButton: () => null }))

// Script volume detection (false on iOS/iPadOS Safari)
const volumeSupport = vi.hoisted(() => ({ canSet: true }))
vi.mock('@/hooks/useCanSetVolume', () => ({ useCanSetVolume: () => volumeSupport.canSet }))

const liveChannel = (streamUrl: string): UnifiedChannel => ({
  id: 'live-channel-0',
  name: 'Live',
  number: 0,
  streamUrl,
  type: 'live',
})

const hlsChannel = (id: string, number: number): UnifiedChannel => ({
  id,
  name: `Channel ${number}`,
  number,
  streamUrl: '',
  type: 'ersatztv',
})

const renderPlayer = (channel: UnifiedChannel) => {
  const view = render(
    <DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={vi.fn()} />
  )
  return {
    ...view,
    switchTo: (next: UnifiedChannel) =>
      view.rerender(<DualModeVideoPlayer channel={next} isTheaterMode={false} onTheaterModeToggle={vi.fn()} />),
  }
}

const video = () => {
  const element = document.querySelector('video')
  if (!element) throw new Error('no video element')
  return element
}

const lastPlayerProps = () => {
  const props = vidstack.mediaPlayer.mock.lastCall?.[0]
  if (!props) throw new Error('MediaPlayer was not rendered')
  return props as MediaPlayerProps
}

const lastPreviewAudio = () => {
  const acquire = highlight.modal.mock.lastCall?.[0].acquirePreviewAudio
  if (!acquire) throw new Error('HighlightModal did not receive acquirePreviewAudio')
  return acquire
}

const wroteAudioStorage = () =>
  vi.mocked(localStorage.setItem).mock.calls.some(([key]) => key === 'audio-storage')

// setup.ts answers every media query with false; this reports the given ones
// as matching until the test ends (restored in afterEach)
const setupMatchMedia = window.matchMedia
const matchMediaQueries = (matching: string[]) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: matching.includes(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }),
  })
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const loader = () => document.querySelector('.projector-beam')
const refuseAutoplay = (error: Error) =>
  act(() => lastPlayerProps().onAutoPlayFail?.({ muted: false, error }))
const reducedMotionError = () =>
  new Error('[vidstack] autoplay is blocked due to user preference for reduced motion')
const policyError = () => new DOMException('play() failed because the user did not interact', 'NotAllowedError')
const soundOffNotice = () => screen.queryByRole('button', { name: /Sound is off/ })
const startPlaybackButton = () => screen.queryByRole('button', { name: 'Start playback' })

beforeEach(() => {
  localStorage.clear()
  useAudioStore.setState({ volume: 1, muted: false })
  useFilterStore.setState({ activeFilters: [] })
  vidstack.state = { paused: false, volume: 1, muted: false, fullscreen: false }
  vidstack.mediaPlayer.mockClear()
  vidstack.mounted.mockClear()
  Object.values(vidstack.remote).forEach((fn) => fn.mockClear())
  vidstack.player.play.mockReset().mockResolvedValue(undefined)
  highlight.enabled = false
  highlight.modal.mockClear()
  volumeSupport.canSet = true
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: setupMatchMedia })
})

describe('DualModeVideoPlayer audio: live channel (mpegts)', () => {
  it('keeps 30% and mute when the live stream changes', () => {
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))

    expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: true })
    const first = video()
    expect(first.volume).toBe(0.3)
    expect(first.muted).toBe(true)

    switchTo(liveChannel('https://fixture/b'))

    expect(video()).not.toBe(first)
    expect(video().volume).toBe(0.3)
    expect(video().muted).toBe(true)
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument()
  })

  it('starts at the saved level and mute', () => {
    useAudioStore.setState({ volume: 0.45, muted: true })
    renderPlayer(liveChannel('https://fixture/a'))

    expect(video().volume).toBe(0.45)
    expect(video().muted).toBe(true)
  })

  it('treats dragging to 0 as a mute that keeps the level', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(liveChannel('https://fixture/a'))

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0' } })

    expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: true })
    expect(video().muted).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))
    expect(video().muted).toBe(false)
    expect(video().volume).toBe(0.3)
  })

  it('unmutes a mute the element picked up elsewhere', () => {
    renderPlayer(liveChannel('https://fixture/a'))

    act(() => {
      video().muted = true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))

    expect(video().muted).toBe(false)
    expect(useAudioStore.getState().muted).toBe(false)
  })

  it('saves keyboard volume changes', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(liveChannel('https://fixture/a'))

    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    expect(useAudioStore.getState().volume).toBe(0.2)
    expect(video().volume).toBe(0.2)
  })

  it('the clip preview duck mutes the element but never writes audio-storage', () => {
    highlight.enabled = true
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(liveChannel('https://fixture/a'))
    vi.mocked(localStorage.setItem).mockClear()

    let release = () => {}
    act(() => {
      release = lastPreviewAudio()()
    })
    expect(video().muted).toBe(true)
    expect(useAudioStore.getState().muted).toBe(false)
    expect(wroteAudioStorage()).toBe(false)

    act(() => release())
    expect(video().muted).toBe(false)
    expect(wroteAudioStorage()).toBe(false)
  })

  it('the clip preview release restores a mute saved during the preview', () => {
    highlight.enabled = true
    renderPlayer(liveChannel('https://fixture/a'))

    let release = () => {}
    act(() => {
      release = lastPreviewAudio()()
    })
    act(() => useAudioStore.getState().setMuted(true))
    act(() => release())

    expect(video().muted).toBe(true)
  })
})

describe('DualModeVideoPlayer audio: ErsatzTV channel (Vidstack)', () => {
  it('keeps 30% and mute across ErsatzTV channels', () => {
    const { switchTo } = renderPlayer(hlsChannel('1', 1))

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))

    expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: true })
    expect(lastPlayerProps()).toMatchObject({ volume: 0.3, muted: true, keyDisabled: true })

    vidstack.mounted.mockClear()
    switchTo(hlsChannel('2', 2))

    expect(vidstack.mounted).toHaveBeenCalledTimes(1)
    expect(lastPlayerProps()).toMatchObject({ volume: 0.3, muted: true, keyDisabled: true })
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument()
  })

  it('keeps 30% and mute across engine types', () => {
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))

    switchTo(hlsChannel('1', 1))
    expect(lastPlayerProps()).toMatchObject({ volume: 0.3, muted: true })

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))

    switchTo(liveChannel('https://fixture/a'))
    expect(video().volume).toBe(0.45)
    expect(video().muted).toBe(true)
  })

  it('a stream retry remounts MediaPlayer with the current level and mute', async () => {
    renderPlayer(hlsChannel('1', 1))

    // Changed after tuning in, so a mount-time snapshot would be stale
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    vidstack.mounted.mockClear()

    act(() => lastPlayerProps().onError?.())

    await waitFor(() => expect(vidstack.mounted).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(lastPlayerProps()).toMatchObject({ volume: 0.45, muted: true })
  })

  it('the slider shows the saved level while Vidstack still reports 100%', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    vidstack.state.volume = 1
    renderPlayer(hlsChannel('1', 1))

    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.3')
    expect(lastPlayerProps().volume).toBe(0.3)
  })

  it('arrow keys on the focused player save the level instead of reaching Vidstack', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(hlsChannel('1', 1))
    const player = document.querySelector<HTMLElement>('[data-media-player]')
    if (!player) throw new Error('no media player')

    player.focus()
    fireEvent.keyDown(player, { key: 'ArrowLeft' })

    expect(useAudioStore.getState().volume).toBe(0.2)
    expect(lastPlayerProps().volume).toBe(0.2)
    expect(vidstack.remote.changeVolume).not.toHaveBeenCalled()
  })

  it('treats dragging to 0 as a mute that keeps the level', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(hlsChannel('1', 1))

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0' } })

    expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: true })
    expect(lastPlayerProps()).toMatchObject({ volume: 0.3, muted: true })
  })

  it('unmuting saves the choice and asks Vidstack to unmute', () => {
    useAudioStore.setState({ volume: 0.3, muted: true })
    renderPlayer(hlsChannel('1', 1))

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }))

    expect(useAudioStore.getState().muted).toBe(false)
    expect(lastPlayerProps().muted).toBe(false)
    expect(vidstack.remote.unmute).toHaveBeenCalled()
  })

  it('the clip preview duck mutes through Vidstack but never writes audio-storage', () => {
    highlight.enabled = true
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(hlsChannel('1', 1))
    vi.mocked(localStorage.setItem).mockClear()

    let release = () => {}
    act(() => {
      release = lastPreviewAudio()()
    })
    expect(vidstack.remote.mute).toHaveBeenCalledTimes(1)
    expect(useAudioStore.getState().muted).toBe(false)
    expect(lastPlayerProps().muted).toBe(false)

    act(() => release())
    expect(vidstack.remote.unmute).toHaveBeenCalledTimes(1)
    expect(wroteAudioStorage()).toBe(false)
  })

  it('the clip preview release keeps a mute saved during the preview', () => {
    highlight.enabled = true
    renderPlayer(hlsChannel('1', 1))

    let release = () => {}
    act(() => {
      release = lastPreviewAudio()()
    })
    act(() => useAudioStore.getState().setMuted(true))
    act(() => release())

    expect(vidstack.remote.unmute).not.toHaveBeenCalled()
    expect(lastPlayerProps().muted).toBe(true)
  })
})

describe('DualModeVideoPlayer audio: keyboard', () => {
  const focusedPlayer = () => {
    const player = document.querySelector<HTMLElement>('[data-media-player]')
    if (!player) throw new Error('no media player')
    player.focus()
    return player
  }

  it('ArrowDown on the focused ErsatzTV player lowers the saved level', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(hlsChannel('1', 1))

    fireEvent.keyDown(focusedPlayer(), { key: 'ArrowDown' })

    expect(useAudioStore.getState().volume).toBe(0.2)
    expect(lastPlayerProps().volume).toBe(0.2)
  })

  it('ArrowUp raises the saved level on the live channel', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(liveChannel('https://fixture/a'))

    fireEvent.keyDown(window, { key: 'ArrowUp' })

    expect(useAudioStore.getState().volume).toBe(0.4)
    expect(video().volume).toBe(0.4)
  })

  it('M and arrows work with a player button focused', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(hlsChannel('1', 1))
    const mute = screen.getByRole('button', { name: 'Mute' })
    mute.focus()

    fireEvent.keyDown(mute, { key: 'ArrowDown' })
    fireEvent.keyDown(mute, { key: 'm' })

    expect(useAudioStore.getState()).toMatchObject({ volume: 0.2, muted: true })
  })

  it('leaves Up/Down to channel changes in TV mode', () => {
    localStorage.setItem('tv-mode', 'true')
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(hlsChannel('1', 1))

    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(focusedPlayer(), { key: 'ArrowDown' })

    expect(useAudioStore.getState().volume).toBe(0.3)
  })
})

describe('DualModeVideoPlayer fullscreen state', () => {
  const setFullscreenElement = (element: Element | null) => {
    act(() => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
  }

  afterEach(() => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  })

  // The element each engine's fullscreen button sends fullscreen
  const liveContainer = () => document.querySelector('.video-player-container')
  const hlsContainer = () => document.querySelector('[data-media-player]')?.parentElement ?? null

  it.each([
    ['live', liveChannel('https://fixture/a'), liveContainer],
    ['ErsatzTV', hlsChannel('1', 1), hlsContainer],
  ])('%s: Exit fullscreen and no Theater only while its container is fullscreen', (_engine, channel, container) => {
    renderPlayer(channel)

    setFullscreenElement(document.createElement('div'))
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Theater mode' })).toBeInTheDocument()

    setFullscreenElement(container())
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Theater mode' })).not.toBeInTheDocument()
  })
})

describe('DualModeVideoPlayer filters', () => {
  // Filters and the control bar share z-10 with no stacking context between
  // them, so whichever comes later in the DOM paints on top
  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: Noir and Grindhouse render before the control bar', (_engine, channel) => {
    useFilterStore.setState({ activeFilters: ['noir', 'grindhouse'] })
    renderPlayer(channel)

    const toolbar = screen.getByRole('toolbar', { name: 'Video controls' })
    for (const selector of ['.noir-filter', '.grindhouse-filter']) {
      const filter = document.querySelector(selector)
      if (!filter) throw new Error(`${selector} not rendered`)
      expect(filter.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})

describe('DualModeVideoPlayer audio: browsers that ignore script volume (iOS/iPadOS)', () => {
  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: no slider, arrow keys save nothing, Mute still works', (_engine, channel) => {
    volumeSupport.canSet = false
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(channel)

    expect(screen.queryByRole('slider', { name: 'Volume' })).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: false })

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(useAudioStore.getState().muted).toBe(true)
  })
})

describe('DualModeVideoPlayer autoplay: ErsatzTV channel (Vidstack)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('under Reduce Motion, plays once more on the next tick after Vidstack refuses autoplay', async () => {
    matchMediaQueries([REDUCED_MOTION])
    renderPlayer(hlsChannel('1', 1))

    refuseAutoplay(reducedMotionError())
    // autoPlaying is still set while the event dispatches, so not yet
    expect(vidstack.player.play).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(vidstack.player.play).toHaveBeenCalledTimes(1)
    expect(vidstack.remote.mute).not.toHaveBeenCalled()
    expect(useAudioStore.getState().muted).toBe(false)
  })

  it('under Reduce Motion, removes the loader when autoplay and the retry are both refused', async () => {
    matchMediaQueries([REDUCED_MOTION])
    vidstack.player.play.mockRejectedValue(new Error('media error'))
    renderPlayer(hlsChannel('1', 1))
    expect(loader()).toBeInTheDocument()

    refuseAutoplay(reducedMotionError())
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(vidstack.player.play).toHaveBeenCalledTimes(1)
    expect(loader()).not.toBeInTheDocument()
  })

  it('without Reduce Motion, a refused autoplay removes the loader and does not retry unmuted', async () => {
    renderPlayer(hlsChannel('1', 1))
    expect(loader()).toBeInTheDocument()

    refuseAutoplay(new Error('media error'))
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(loader()).not.toBeInTheDocument()
    expect(vidstack.player.play).not.toHaveBeenCalled()
  })

  it('a policy refusal mutes the element only, plays on the next tick and says the sound is off', async () => {
    useAudioStore.setState({ volume: 0.62, muted: false })
    renderPlayer(hlsChannel('1', 1))
    vi.mocked(localStorage.setItem).mockClear()

    refuseAutoplay(policyError())
    expect(vidstack.remote.mute).toHaveBeenCalledTimes(1)
    expect(vidstack.player.play).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(vidstack.player.play).toHaveBeenCalledTimes(1)
    expect(vidstack.remote.mute.mock.invocationCallOrder[0]).toBeLessThan(
      vidstack.player.play.mock.invocationCallOrder[0]
    )
    expect(soundOffNotice()).toHaveTextContent('Restore 62%')
    expect(loader()).not.toBeInTheDocument()
    // The saved preference and the controlled prop keep the viewer's choice
    expect(useAudioStore.getState().muted).toBe(false)
    expect(lastPlayerProps().muted).toBe(false)
    expect(wroteAudioStorage()).toBe(false)
  })

  it('tapping the notice unmutes the element and dismisses it', async () => {
    renderPlayer(hlsChannel('1', 1))
    refuseAutoplay(policyError())
    await act(() => vi.advanceTimersByTimeAsync(0))

    fireEvent.click(soundOffNotice()!)

    expect(vidstack.remote.unmute).toHaveBeenCalledTimes(1)
    expect(soundOffNotice()).not.toBeInTheDocument()
    expect(useAudioStore.getState().muted).toBe(false)
  })

  it('the notice goes away when the element is unmuted some other way', async () => {
    renderPlayer(hlsChannel('1', 1))
    refuseAutoplay(policyError())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(soundOffNotice()).toBeInTheDocument()

    act(() => lastPlayerProps().onVolumeChange?.({ volume: 1, muted: true }))
    expect(soundOffNotice()).toBeInTheDocument()

    act(() => lastPlayerProps().onVolumeChange?.({ volume: 1, muted: false }))
    expect(soundOffNotice()).not.toBeInTheDocument()
  })

  it('when even muted playback is refused, hides the loader and shows a Play button that plays with sound', async () => {
    vidstack.player.play.mockRejectedValueOnce(policyError())
    renderPlayer(hlsChannel('1', 1))

    refuseAutoplay(policyError())
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(loader()).not.toBeInTheDocument()
    expect(soundOffNotice()).not.toBeInTheDocument()
    fireEvent.click(startPlaybackButton()!)

    expect(vidstack.remote.unmute).toHaveBeenCalledTimes(1)
    expect(vidstack.player.play).toHaveBeenCalledTimes(2)
    expect(startPlaybackButton()).not.toBeInTheDocument()
  })

  it('with sound saved as muted, a refusal goes straight to the Play button', async () => {
    useAudioStore.setState({ volume: 0.5, muted: true })
    renderPlayer(hlsChannel('1', 1))

    act(() => lastPlayerProps().onAutoPlayFail?.({ muted: true, error: policyError() }))
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(vidstack.remote.mute).not.toHaveBeenCalled()
    fireEvent.click(startPlaybackButton()!)
    // The tap plays but keeps the saved mute
    expect(vidstack.remote.unmute).not.toHaveBeenCalled()
    expect(vidstack.player.play).toHaveBeenCalledTimes(1)
  })

  it('under Reduce Motion, a policy refusal of the retry falls back to muted playback', async () => {
    matchMediaQueries([REDUCED_MOTION])
    vidstack.player.play.mockRejectedValueOnce(policyError())
    renderPlayer(hlsChannel('1', 1))

    refuseAutoplay(reducedMotionError())
    await act(() => vi.advanceTimersByTimeAsync(0))
    // The fake clock schedules a 0ms timer set during a tick 1ms out
    await act(() => vi.advanceTimersByTimeAsync(1))

    expect(vidstack.remote.mute).toHaveBeenCalledTimes(1)
    expect(vidstack.player.play).toHaveBeenCalledTimes(2)
    expect(soundOffNotice()).toBeInTheDocument()
  })

  it('a stream retry remount drops the notice from the previous mount', async () => {
    renderPlayer(hlsChannel('1', 1))
    refuseAutoplay(policyError())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(soundOffNotice()).toBeInTheDocument()

    vidstack.mounted.mockClear()
    act(() => lastPlayerProps().onError?.())
    await act(() => vi.advanceTimersByTimeAsync(1000))

    expect(vidstack.mounted).toHaveBeenCalledTimes(1)
    expect(soundOffNotice()).not.toBeInTheDocument()
  })
})

describe('DualModeVideoPlayer autoplay: live channel (mpegts)', () => {
  const playSpy = () => vi.mocked(HTMLMediaElement.prototype.play)

  it('a policy refusal mutes the element, retries and says the sound is off, leaving the saved mute alone', async () => {
    useAudioStore.setState({ volume: 0.4, muted: false })
    playSpy().mockRejectedValueOnce(policyError())
    vi.mocked(localStorage.setItem).mockClear()
    renderPlayer(liveChannel('https://fixture/a'))

    await waitFor(() => expect(soundOffNotice()).toHaveTextContent('Restore 40%'))
    expect(video().muted).toBe(true)
    expect(playSpy()).toHaveBeenCalledTimes(2)
    expect(useAudioStore.getState().muted).toBe(false)
    expect(wroteAudioStorage()).toBe(false)

    fireEvent.click(soundOffNotice()!)

    expect(video().muted).toBe(false)
    expect(soundOffNotice()).not.toBeInTheDocument()
    expect(useAudioStore.getState().muted).toBe(false)
  })

  it('when even muted playback is refused, shows a Play button that goes once playback starts', async () => {
    playSpy().mockRejectedValueOnce(policyError()).mockRejectedValueOnce(policyError())
    renderPlayer(liveChannel('https://fixture/a'))

    await waitFor(() => expect(startPlaybackButton()).toBeInTheDocument())
    fireEvent.click(startPlaybackButton()!)

    expect(video().muted).toBe(false)
    expect(playSpy()).toHaveBeenCalledTimes(3)
    act(() => {
      video().dispatchEvent(new Event('playing'))
    })
    expect(startPlaybackButton()).not.toBeInTheDocument()
  })
})

describe('DualModeVideoPlayer touch: a tap toggles the controls once', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    matchMediaQueries(['(pointer: coarse)'])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const toolbar = () => screen.getByRole('toolbar', { name: 'Video controls' })
  const picture = () => {
    const element = document.querySelector('video') ?? document.querySelector('[data-media-player]')
    if (!element) throw new Error('no picture')
    return element
  }

  // What a browser fires for one tap, in order. Each is a separate discrete
  // event, so React renders between them.
  const tapPicture = () => {
    const events = [
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }),
      new Event('touchstart', { bubbles: true }),
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }),
      new Event('touchend', { bubbles: true }),
      new MouseEvent('mousemove', { bubbles: true }),
      new MouseEvent('mousedown', { bubbles: true }),
      new MouseEvent('mouseup', { bubbles: true }),
      new MouseEvent('click', { bubbles: true }),
    ]
    for (const event of events) {
      act(() => {
        picture().dispatchEvent(event)
      })
    }
  }

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: after auto-hide, one tap brings the controls back and the next hides them', (engine, channel) => {
    renderPlayer(channel)
    if (engine === 'live') {
      act(() => {
        video().dispatchEvent(new Event('playing'))
      })
    }
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(toolbar()).toHaveClass('opacity-0')

    tapPicture()
    expect(toolbar()).toHaveClass('opacity-100')

    tapPicture()
    expect(toolbar()).toHaveClass('opacity-0')
  })
})
