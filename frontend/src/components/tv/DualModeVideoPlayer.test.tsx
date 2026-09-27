import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode, Ref } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@/test/utils'
import { DualModeVideoPlayer } from './DualModeVideoPlayer'
import { useAudioStore } from '@/stores/audioStore'
import { useFilterStore } from '@/stores/filterStore'
import { useChannelStore } from '@/stores/channelStore'
import { useUIStore } from '@/stores/uiStore'
import { useClipStore } from '@/stores/clipStore'
import type { UnifiedChannel } from '@/types'
import type { PlayerShell } from '@/components/player/PlayerShellContext'

// ----------------------------------------------------------------------------
// Harness: both engines are mocked. mpegts.js gets a stub player; Vidstack's
// MediaPlayer records its props and renders a focusable data-media-player div.
// ----------------------------------------------------------------------------

// Every player mpegts.js creates, with the handlers it was given
const mpegtsHarness = vi.hoisted(() => {
  type StubPlayer = {
    handlers: Map<string, () => void>
    attachMediaElement: () => void
    load: () => void
    on: (event: string, handler: () => void) => void
    destroy: () => void
  }
  const players: StubPlayer[] = []
  const createPlayer = vi.fn(() => {
    const handlers = new Map<string, () => void>()
    const player: StubPlayer = {
      handlers,
      attachMediaElement: vi.fn(),
      load: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler)
      }),
      destroy: vi.fn(),
    }
    players.push(player)
    return player
  })
  return { players, createPlayer }
})

vi.mock('mpegts.js', () => ({
  default: {
    isSupported: () => true,
    createPlayer: mpegtsHarness.createPlayer,
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
    state: { paused: false, volume: 1, muted: false, fullscreen: false, canPlay: false } as Record<string, unknown>,
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

const highlight = vi.hoisted(() => ({ enabled: false }))
vi.mock('@/hooks/useHighlightFeature', () => ({
  useHighlightFeature: () => ({ isEnabled: highlight.enabled, isLoading: false }),
}))
vi.mock('@/hooks/useHighlightStatus', () => ({ useHighlightStatus: () => ({}) }))
vi.mock('@/components/HighlightButton', () => ({
  HighlightButton: ({ onOpenModal }: { onOpenModal?: () => void }) => (
    <button type="button" onClick={onOpenModal}>
      Capture clip
    </button>
  ),
}))
// The real clip editor, on a fake capture API
const clipApi = vi.hoisted(() => ({
  createHighlightCapture: vi.fn<(channelId: string, signal?: AbortSignal) => Promise<{ id: string }>>(),
  deleteHighlightCapture: vi.fn<(id: string) => Promise<void>>(),
  getHighlightFeatures: vi.fn<() => Promise<{ enabled: boolean; ziplineEnabled: boolean }>>(),
}))
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  ...clipApi,
  highlightCaptureUrl: (id: string) => `/api/highlight/capture/${id}`,
}))
// The cast button renders in both control bars, so it reports the shell it
// sits in and what it would cast
const shellProbe = vi.hoisted(() => ({ current: null as PlayerShell | null }))
const castProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock('@/components/CastButton', async () => {
  const { usePlayerShell } = await import('@/components/player/PlayerShellContext')
  return {
    CastButton: (props: Record<string, unknown>) => {
      shellProbe.current = usePlayerShell()
      castProps.current = props
      return null
    },
  }
})

// The NHL ticker's scores: a day with no games, so nothing is fetched
vi.mock('@/hooks/useNHLScores', () => ({
  useNHLScores: () => ({
    data: { games: [], date: '2026-09-27', liveGameCount: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

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

// The stable player shell: the fullscreen element around the engine
const shell = () => {
  const element = document.querySelector<HTMLElement>('.video-player-container')
  if (!element) throw new Error('no player shell')
  return element
}

const lastPlayerProps = () => {
  const props = vidstack.mediaPlayer.mock.lastCall?.[0]
  if (!props) throw new Error('MediaPlayer was not rendered')
  return props as MediaPlayerProps
}

// What the clip editor does while it is open
const holdPreview = () => act(() => useAudioStore.getState().acquirePreview())
const releasePreview = () => act(() => useAudioStore.getState().releasePreview())

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
  useAudioStore.setState({ volume: 1, muted: false, savedMuteNotice: false, previewHolds: 0 })
  useFilterStore.setState({ activeFilters: [] })
  vidstack.state = { paused: false, volume: 1, muted: false, fullscreen: false, canPlay: false }
  vidstack.mediaPlayer.mockClear()
  vidstack.mounted.mockClear()
  Object.values(vidstack.remote).forEach((fn) => fn.mockClear())
  vidstack.player.play.mockReset().mockResolvedValue(undefined)
  highlight.enabled = false
  useClipStore.setState({ session: null })
  clipApi.createHighlightCapture.mockReset().mockResolvedValue({ id: 'capture-1' })
  clipApi.deleteHighlightCapture.mockReset().mockResolvedValue(undefined)
  clipApi.getHighlightFeatures.mockReset().mockResolvedValue({ enabled: true, ziplineEnabled: false })
  volumeSupport.canSet = true
  mpegtsHarness.players.length = 0
  mpegtsHarness.createPlayer.mockClear()
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
    expect(screen.getByRole('button', { name: 'Unmute (30%)' })).toBeInTheDocument()
  })

  it('while muted, the slider keeps the saved level, dimmed', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(liveChannel('https://fixture/a'))

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))

    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.3')
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveClass('opacity-50')
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

    fireEvent.click(screen.getByRole('button', { name: 'Unmute (30%)' }))
    expect(video().muted).toBe(false)
    expect(video().volume).toBe(0.3)
  })

  it('unmutes a mute the element picked up elsewhere', () => {
    renderPlayer(liveChannel('https://fixture/a'))

    act(() => {
      video().muted = true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Unmute (100%)' }))

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

  it('the clip preview hold mutes the element but never writes audio-storage', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(liveChannel('https://fixture/a'))
    vi.mocked(localStorage.setItem).mockClear()

    holdPreview()
    expect(video().muted).toBe(true)
    expect(useAudioStore.getState().muted).toBe(false)
    expect(wroteAudioStorage()).toBe(false)

    releasePreview()
    expect(video().muted).toBe(false)
    expect(video().volume).toBe(0.3)
    expect(wroteAudioStorage()).toBe(false)
  })

  it('the clip preview release restores a mute saved during the preview', () => {
    renderPlayer(liveChannel('https://fixture/a'))

    holdPreview()
    act(() => useAudioStore.getState().setMuted(true))
    releasePreview()

    expect(video().muted).toBe(true)
  })

  it('an unmute during the preview hold is undone when the volume change arrives', () => {
    renderPlayer(liveChannel('https://fixture/a'))
    holdPreview()

    act(() => {
      video().muted = false
    })

    expect(video().muted).toBe(true)
    expect(useAudioStore.getState().muted).toBe(false)
  })

  it('choosing a level during the preview hold saves it but keeps the element silent', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(liveChannel('https://fixture/a'))
    holdPreview()

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.6' } })

    expect(useAudioStore.getState()).toMatchObject({ volume: 0.6, muted: false })
    expect(video().muted).toBe(true)
    releasePreview()
    expect(video().muted).toBe(false)
    expect(video().volume).toBe(0.6)
  })

  it('a new live stream under the preview hold starts silent', () => {
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    holdPreview()

    switchTo(liveChannel('https://fixture/b'))
    expect(video().muted).toBe(true)
    expect(useAudioStore.getState().muted).toBe(false)

    releasePreview()
    expect(video().muted).toBe(false)
  })
})

describe('DualModeVideoPlayer live controls (PlayerChrome)', () => {
  it('Play and Pause drive the element and follow what it does', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    renderPlayer(liveChannel('https://fixture/a'))
    const play = vi.mocked(HTMLMediaElement.prototype.play)
    play.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(play).toHaveBeenCalledTimes(1)

    act(() => {
      video().dispatchEvent(new Event('playing'))
    })
    // jsdom's element never leaves paused, so report it as playing
    vi.spyOn(video(), 'paused', 'get').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(pause).toHaveBeenCalledTimes(1)

    act(() => {
      video().dispatchEvent(new Event('pause'))
    })
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('Theater switches the page layout the player was given', () => {
    const onTheaterModeToggle = vi.fn()
    const { rerender } = render(
      <DualModeVideoPlayer channel={liveChannel('https://fixture/a')} isTheaterMode={false} onTheaterModeToggle={onTheaterModeToggle} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Theater mode' }))
    expect(onTheaterModeToggle).toHaveBeenCalledTimes(1)

    rerender(
      <DualModeVideoPlayer channel={liveChannel('https://fixture/a')} isTheaterMode={true} onTheaterModeToggle={onTheaterModeToggle} />
    )
    expect(screen.getByRole('button', { name: 'Exit theater mode' })).toBeInTheDocument()
  })

  it('casts the live stream as MPEG-TS', () => {
    renderPlayer({ ...liveChannel('https://fixture/a'), backendId: '17' })

    expect(castProps.current).toMatchObject({
      channelId: '17',
      streamType: 'mpegts',
      streamUrl: 'https://fixture/a',
      channelName: 'Live',
    })
  })

  it('opens the clip editor on the live channel from the bar', () => {
    highlight.enabled = true
    renderPlayer({ ...liveChannel('https://fixture/a'), backendId: '17' })

    fireEvent.click(screen.getByRole('button', { name: 'Capture clip' }))

    expect(useClipStore.getState().session).toEqual({ channelId: '17', channelName: 'Live' })
  })
})

describe('DualModeVideoPlayer ErsatzTV controls (PlayerChrome)', () => {
  it("Play and Pause drive Vidstack and follow its paused state", () => {
    vidstack.state.paused = true
    const { rerender } = renderPlayer(hlsChannel('1', 1))

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(vidstack.remote.togglePaused).toHaveBeenCalledTimes(1)

    vidstack.state.paused = false
    rerender(<DualModeVideoPlayer channel={hlsChannel('1', 1)} isTheaterMode={false} onTheaterModeToggle={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(vidstack.remote.togglePaused).toHaveBeenCalledTimes(2)
  })

  it('Theater switches the page layout the player was given', () => {
    const onTheaterModeToggle = vi.fn()
    const { rerender } = render(
      <DualModeVideoPlayer channel={hlsChannel('1', 1)} isTheaterMode={false} onTheaterModeToggle={onTheaterModeToggle} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Theater mode' }))
    expect(onTheaterModeToggle).toHaveBeenCalledTimes(1)

    rerender(
      <DualModeVideoPlayer channel={hlsChannel('1', 1)} isTheaterMode={true} onTheaterModeToggle={onTheaterModeToggle} />
    )
    expect(screen.getByRole('button', { name: 'Exit theater mode' })).toBeInTheDocument()
  })

  it('T switches theater from the keyboard', () => {
    const onTheaterModeToggle = vi.fn()
    render(<DualModeVideoPlayer channel={hlsChannel('1', 1)} isTheaterMode={false} onTheaterModeToggle={onTheaterModeToggle} />)

    fireEvent.keyDown(window, { key: 't' })

    expect(onTheaterModeToggle).toHaveBeenCalledTimes(1)
  })

  it('casts the ErsatzTV stream as HLS', () => {
    localStorage.setItem('token', 'fixture-token')
    renderPlayer(hlsChannel('7', 7))

    expect(castProps.current).toMatchObject({
      channelId: '7',
      streamType: 'hls',
      streamUrl: expect.stringMatching(/\/ersatztv\/stream\/7\?token=fixture-token$/),
      channelName: 'Channel 7',
    })
  })

  it('opens the clip editor on the ErsatzTV channel from the bar', () => {
    highlight.enabled = true
    renderPlayer(hlsChannel('7', 7))

    fireEvent.click(screen.getByRole('button', { name: 'Capture clip' }))

    expect(useClipStore.getState().session).toEqual({ channelId: '7', channelName: 'Channel 7' })
  })

  it('renders one control bar, inside MediaPlayer', () => {
    renderPlayer(hlsChannel('1', 1))

    const bars = screen.getAllByRole('toolbar', { name: 'Video controls' })
    expect(bars).toHaveLength(1)
    expect(bars[0].closest('[data-media-player]')).not.toBeNull()
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
    expect(screen.getByRole('button', { name: 'Unmute (30%)' })).toBeInTheDocument()
  })

  it('while muted, the slider keeps the saved level, dimmed', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(hlsChannel('1', 1))

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))

    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.3')
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveClass('opacity-50')
  })

  it("the bar's slider and Mute save to the audio store, never to Vidstack's own volume", () => {
    renderPlayer(hlsChannel('1', 1))

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))

    expect(useAudioStore.getState()).toMatchObject({ volume: 0.5, muted: true })
    expect(lastPlayerProps()).toMatchObject({ volume: 0.5, muted: true })
    expect(vidstack.remote.changeVolume).not.toHaveBeenCalled()
    expect(vidstack.remote.toggleMuted).not.toHaveBeenCalled()
  })

  it('a mute only the element has shows Unmute, which asks Vidstack to unmute and saves nothing new', () => {
    useAudioStore.setState({ volume: 0.6, muted: false })
    vidstack.state.muted = true
    renderPlayer(hlsChannel('1', 1))

    fireEvent.click(screen.getByRole('button', { name: 'Unmute (60%)' }))

    expect(vidstack.remote.unmute).toHaveBeenCalledTimes(1)
    expect(useAudioStore.getState()).toMatchObject({ volume: 0.6, muted: false })
    expect(lastPlayerProps().muted).toBe(false)
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

    fireEvent.click(screen.getByRole('button', { name: 'Unmute (30%)' }))

    expect(useAudioStore.getState().muted).toBe(false)
    expect(lastPlayerProps().muted).toBe(false)
    expect(vidstack.remote.unmute).toHaveBeenCalled()
  })

  it('the clip preview hold mutes MediaPlayer but never writes audio-storage', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(hlsChannel('1', 1))
    vi.mocked(localStorage.setItem).mockClear()

    holdPreview()
    expect(lastPlayerProps()).toMatchObject({ volume: 0.3, muted: true })
    expect(useAudioStore.getState().muted).toBe(false)

    releasePreview()
    expect(lastPlayerProps()).toMatchObject({ volume: 0.3, muted: false })
    expect(wroteAudioStorage()).toBe(false)
  })

  it('the clip preview release keeps a mute saved during the preview', () => {
    renderPlayer(hlsChannel('1', 1))

    holdPreview()
    act(() => useAudioStore.getState().setMuted(true))
    releasePreview()

    expect(lastPlayerProps().muted).toBe(true)
  })

  it('an unmute Vidstack reports during the preview hold is undone', () => {
    renderPlayer(hlsChannel('1', 1))
    holdPreview()

    // Vidstack's volume events arrive after the request that caused them
    act(() => lastPlayerProps().onVolumeChange?.({ volume: 1, muted: false }))

    expect(vidstack.remote.mute).toHaveBeenCalledTimes(1)
    expect(useAudioStore.getState().muted).toBe(false)
  })

  it('an unmute reported after the preview hold ends is left alone', () => {
    renderPlayer(hlsChannel('1', 1))
    holdPreview()
    releasePreview()

    act(() => lastPlayerProps().onVolumeChange?.({ volume: 1, muted: false }))

    expect(vidstack.remote.mute).not.toHaveBeenCalled()
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

  it.each([
    ['live', liveChannel('https://fixture/a'), () => video().muted],
    ['ErsatzTV', hlsChannel('1', 1), () => lastPlayerProps().muted],
  ])('%s: ArrowUp while muted comes back at the saved level', (_engine, channel, elementMuted) => {
    useAudioStore.setState({ volume: 0.6, muted: true })
    renderPlayer(channel)

    fireEvent.keyDown(window, { key: 'ArrowUp' })

    expect(useAudioStore.getState()).toMatchObject({ volume: 0.6, muted: false })
    expect(elementMuted()).toBe(false)
  })

  it.each([
    ['live', liveChannel('https://fixture/a'), () => video().muted],
    ['ErsatzTV', hlsChannel('1', 1), () => lastPlayerProps().muted],
  ])('%s: ArrowDown while muted keeps the mute and the saved level', (_engine, channel, elementMuted) => {
    useAudioStore.setState({ volume: 0.6, muted: true })
    renderPlayer(channel)
    vi.mocked(localStorage.setItem).mockClear()

    fireEvent.keyDown(window, { key: 'ArrowDown' })

    expect(useAudioStore.getState()).toMatchObject({ volume: 0.6, muted: true })
    expect(elementMuted()).toBe(true)
    expect(wroteAudioStorage()).toBe(false)
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

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: Exit fullscreen and no Theater only while the shell is fullscreen', (_engine, channel) => {
    renderPlayer(channel)

    setFullscreenElement(document.createElement('div'))
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Theater mode' })).toBeInTheDocument()

    setFullscreenElement(shell())
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Theater mode' })).not.toBeInTheDocument()

    setFullscreenElement(null)
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Theater mode' })).toBeInTheDocument()
  })

  // Vidstack only reports its own MediaPlayer element as fullscreen, never the shell
  it("ErsatzTV: the bar ignores Vidstack's own fullscreen state", () => {
    vidstack.state.fullscreen = true
    renderPlayer(hlsChannel('1', 1))

    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Theater mode' })).toBeInTheDocument()

    setFullscreenElement(shell())
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
  })

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: on a TV that looks like a touch device, Theater and Fullscreen stay, and Fullscreen fullscreens the shell', (_engine, channel) => {
    // webOS pointer mode can report pointer:coarse, so TV mode must win
    localStorage.setItem('tv-mode', 'true')
    matchMediaQueries(['(pointer: coarse)'])
    const original = HTMLElement.prototype.requestFullscreen
    const requestFullscreen = vi.fn(() => Promise.resolve())
    HTMLElement.prototype.requestFullscreen = requestFullscreen
    try {
      renderPlayer(channel)

      expect(screen.getByRole('button', { name: 'Theater mode' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))

      expect(requestFullscreen).toHaveBeenCalledTimes(1)
      expect(requestFullscreen.mock.contexts[0]).toBe(shell())
    } finally {
      HTMLElement.prototype.requestFullscreen = original
    }
  })

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: the Fullscreen button and F key fullscreen the shell', (_engine, channel) => {
    const original = HTMLElement.prototype.requestFullscreen
    const requestFullscreen = vi.fn(() => Promise.resolve())
    HTMLElement.prototype.requestFullscreen = requestFullscreen
    try {
      renderPlayer(channel)

      fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
      fireEvent.keyDown(window, { key: 'f' })

      expect(requestFullscreen).toHaveBeenCalledTimes(2)
      for (const target of requestFullscreen.mock.contexts) expect(target).toBe(shell())
    } finally {
      HTMLElement.prototype.requestFullscreen = original
    }
  })

  // The toggle asks the same question as the button's state: is the shell
  // itself the fullscreen element?
  describe('toggle', () => {
    const original = HTMLElement.prototype.requestFullscreen
    const requestFullscreen = vi.fn(() => Promise.resolve())
    const exitFullscreen = vi.fn(() => Promise.resolve())

    beforeEach(() => {
      requestFullscreen.mockClear()
      exitFullscreen.mockClear()
      HTMLElement.prototype.requestFullscreen = requestFullscreen
      Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    })

    afterEach(() => {
      HTMLElement.prototype.requestFullscreen = original
      Reflect.deleteProperty(document, 'exitFullscreen')
    })

    it.each([
      ['live', liveChannel('https://fixture/a')],
      ['ErsatzTV', hlsChannel('1', 1)],
    ])('%s: F enters on the shell while another element is fullscreen, and exits only the shell', (_engine, channel) => {
      renderPlayer(channel)

      setFullscreenElement(document.createElement('div'))
      fireEvent.keyDown(window, { key: 'f' })
      expect(requestFullscreen).toHaveBeenCalledTimes(1)
      expect(requestFullscreen.mock.contexts[0]).toBe(shell())
      expect(exitFullscreen).not.toHaveBeenCalled()

      setFullscreenElement(shell())
      fireEvent.keyDown(window, { key: 'f' })
      expect(exitFullscreen).toHaveBeenCalledTimes(1)
      expect(requestFullscreen).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['live', liveChannel('https://fixture/a')],
      ['ErsatzTV', hlsChannel('1', 1)],
    ])('%s: the Fullscreen button enters on the shell while another element is fullscreen', (_engine, channel) => {
      renderPlayer(channel)

      setFullscreenElement(document.createElement('div'))
      fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))

      expect(requestFullscreen).toHaveBeenCalledTimes(1)
      expect(requestFullscreen.mock.contexts[0]).toBe(shell())
      expect(exitFullscreen).not.toHaveBeenCalled()
    })
  })
})

describe('DualModeVideoPlayer shell: fullscreen survives engine swaps', () => {
  // A getter, so the stub always reports the element the test captured
  let fullscreenElement: Element | null = null
  beforeEach(() => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
  })
  afterEach(() => {
    fullscreenElement = null
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  })

  const enterFullscreen = () => {
    const element = shell()
    act(() => {
      fullscreenElement = element
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    return element
  }

  it('a new live stream re-initialises only the engine', () => {
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    const fullscreen = enterFullscreen()
    const firstVideo = video()

    switchTo(liveChannel('https://fixture/b'))

    expect(video()).not.toBe(firstVideo)
    expect(shell()).toBe(fullscreen)
    expect(fullscreen.isConnected).toBe(true)
    expect(fullscreen).toContainElement(video())
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
  })

  it('a new ErsatzTV channel re-initialises only the engine', () => {
    const { switchTo } = renderPlayer(hlsChannel('1', 1))
    const fullscreen = enterFullscreen()
    vidstack.mounted.mockClear()

    switchTo(hlsChannel('2', 2))

    expect(vidstack.mounted).toHaveBeenCalledTimes(1)
    expect(shell()).toBe(fullscreen)
    expect(fullscreen.isConnected).toBe(true)
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
  })

  it('switching between engine types keeps the shell', () => {
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    const fullscreen = enterFullscreen()

    switchTo(hlsChannel('1', 1))
    expect(shell()).toBe(fullscreen)
    expect(fullscreen).toContainElement(document.querySelector<HTMLElement>('[data-media-player]'))

    switchTo(liveChannel(''))
    expect(shell()).toBe(fullscreen)
    expect(fullscreen).toHaveTextContent('No live broadcast')
  })

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: a new reloadKey re-initialises only the engine', (_engine, channel) => {
    const { rerender } = render(
      <DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={vi.fn()} reloadKey={0} />
    )
    const fullscreen = enterFullscreen()
    const firstVideo = document.querySelector('video')
    vidstack.mounted.mockClear()

    rerender(
      <DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={vi.fn()} reloadKey={1} />
    )

    if (channel.type === 'live') expect(video()).not.toBe(firstVideo)
    else expect(vidstack.mounted).toHaveBeenCalledTimes(1)
    expect(shell()).toBe(fullscreen)
    expect(fullscreen.isConnected).toBe(true)
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
  })

  it('reload() from inside the shell re-initialises only the engine', () => {
    renderPlayer(liveChannel('https://fixture/a'))
    const fullscreen = enterFullscreen()
    const firstVideo = video()
    const before = shellProbe.current?.reloadKey

    act(() => shellProbe.current?.reload())

    expect(video()).not.toBe(firstVideo)
    expect(shellProbe.current?.reloadKey).not.toBe(before)
    expect(shell()).toBe(fullscreen)
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
  })

  it('ErsatzTV: counts its retries from 1 of 5', async () => {
    vi.useFakeTimers()
    try {
      renderPlayer(hlsChannel('1', 1))

      act(() => lastPlayerProps().onError?.())
      expect(screen.getByText('Stream starting... (1/5)')).toBeInTheDocument()

      await act(() => vi.advanceTimersByTimeAsync(1000))
      act(() => lastPlayerProps().onError?.())
      expect(screen.getByText('Stream starting... (2/5)')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the ErsatzTV failed state renders inside the shell', async () => {
    vi.useFakeTimers()
    try {
      renderPlayer(hlsChannel('1', 1))
      const fullscreen = enterFullscreen()

      // useStreamRecovery gives up after its reconnects
      for (let i = 0; i < 10 && !screen.queryByText('Stream unavailable'); i++) {
        act(() => lastPlayerProps().onError?.())
        await act(() => vi.advanceTimersByTimeAsync(5000))
      }

      expect(screen.getByText('Stream unavailable')).toBeInTheDocument()
      expect(shell()).toBe(fullscreen)
      expect(fullscreen).toContainElement(screen.getByText('Stream unavailable'))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('DualModeVideoPlayer live reconnect', () => {
  // jsdom's element is always paused at 0s; these stand in for playback
  let isPaused = false
  let currentTime = 0
  let visibility: DocumentVisibilityState = 'visible'

  beforeEach(() => {
    vi.useFakeTimers()
    isPaused = false
    currentTime = 0
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  })
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'visibilityState')
  })

  const renderLive = () => {
    const view = renderPlayer(liveChannel('https://fixture/a'))
    Object.defineProperty(video(), 'paused', { configurable: true, get: () => isPaused })
    Object.defineProperty(video(), 'currentTime', { configurable: true, get: () => currentTime })
    return view
  }

  const players = () => mpegtsHarness.players
  const lastPlayer = () => {
    const player = players().at(-1)
    if (!player) throw new Error('no mpegts player')
    return player
  }
  const emit = (event: 'error' | 'loading_complete') => act(() => lastPlayer().handlers.get(event)?.())
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
  const reconnecting = (attempt: number) => screen.queryByText(`Reconnecting... ${attempt} of 5`)

  it('an mpegts error says it is reconnecting, keeps the controls and starts a new player after 1s', async () => {
    renderLive()
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(1)
    const first = lastPlayer()
    const element = video()

    emit('error')

    expect(reconnecting(1)).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Video controls' })).toBeInTheDocument()
    await advance(999)
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(2)
    expect(first.destroy).toHaveBeenCalledTimes(1)
    // Same element, same shell: only the mpegts player is new
    expect(video()).toBe(element)
    expect(lastPlayer().attachMediaElement).toHaveBeenCalledWith(element)
  })

  it("the element's error and the player's error in one failure count as one reconnect", async () => {
    renderLive()

    emit('error')
    act(() => {
      video().dispatchEvent(new Event('error'))
    })

    expect(reconnecting(1)).toBeInTheDocument()
    await advance(1000)
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(2)
    // No second reconnect queued (the new player gets its own 8s stall window)
    await advance(5000)
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(2)
    expect(reconnecting(1)).toBeInTheDocument()
  })

  it('the upstream closing while playing reconnects, but not while paused', async () => {
    renderLive()
    isPaused = true

    emit('loading_complete')
    await advance(10_000)
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(1)
    expect(reconnecting(1)).not.toBeInTheDocument()

    isPaused = false
    emit('loading_complete')
    expect(reconnecting(1)).toBeInTheDocument()
    await advance(1000)
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(2)
  })

  it('the watchdog reconnects when the picture stands still for 8s while playing', async () => {
    renderLive()

    // Moving: no stall however long it plays
    for (let i = 0; i < 10; i++) {
      currentTime += 1
      await advance(1000)
    }
    expect(reconnecting(1)).not.toBeInTheDocument()

    await advance(7000)
    expect(reconnecting(1)).not.toBeInTheDocument()
    await advance(1000)
    expect(reconnecting(1)).toBeInTheDocument()
    await advance(1000)
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(2)
  })

  // Destroying an mpegts player reloads the element, and a reload rejects a
  // play() still pending with AbortError
  const holdPlayUntilDestroy = () => {
    const pending: Array<(reason: unknown) => void> = []
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          pending.push(reject)
        })
    )
    return () => {
      vi.mocked(lastPlayer().destroy).mockImplementation(() => {
        for (const reject of pending.splice(0)) {
          reject(new DOMException('The play() request was interrupted by a new load request', 'AbortError'))
        }
      })
    }
  }

  it('an attempt a reconnect or the stop interrupts never asks for a tap to play', async () => {
    const abortPlayOnDestroy = holdPlayUntilDestroy()
    renderLive()

    for (const delay of [1000, 2000, 4000, 8000, 8000]) {
      abortPlayOnDestroy()
      emit('error')
      await advance(delay)
      expect(startPlaybackButton()).not.toBeInTheDocument()
    }
    abortPlayOnDestroy()
    emit('error')
    await advance(0)

    expect(lastPlayer().destroy).toHaveBeenCalledTimes(1)
    expect(startPlaybackButton()).not.toBeInTheDocument()
  })

  it('a tap to play that a reconnect interrupts does not ask again', async () => {
    const abortPlayOnDestroy = holdPlayUntilDestroy()
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('no source yet'))
    renderLive()
    await advance(0)
    fireEvent.click(startPlaybackButton()!)
    expect(startPlaybackButton()).not.toBeInTheDocument()

    abortPlayOnDestroy()
    emit('error')
    await advance(1000)

    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(2)
    expect(startPlaybackButton()).not.toBeInTheDocument()
  })

  it('the watchdog leaves a paused player alone', async () => {
    renderLive()
    isPaused = true

    await advance(30_000)

    expect(reconnecting(1)).not.toBeInTheDocument()
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(1)
  })

  it('the watchdog leaves a hidden tab alone, and starts counting afresh when it shows', async () => {
    renderLive()
    visibility = 'hidden'

    await advance(30_000)
    expect(reconnecting(1)).not.toBeInTheDocument()

    visibility = 'visible'
    await advance(7000)
    expect(reconnecting(1)).not.toBeInTheDocument()
    await advance(2000)
    expect(reconnecting(1)).toBeInTheDocument()
  })

  it('playing again starts the count over', async () => {
    renderLive()
    emit('error')
    await advance(1000)
    emit('error')
    expect(reconnecting(2)).toBeInTheDocument()
    await advance(2000)

    act(() => {
      video().dispatchEvent(new Event('playing'))
    })
    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument()

    emit('error')
    expect(reconnecting(1)).toBeInTheDocument()
  })

  it('stops after 5 reconnects, letting go of the upstream', async () => {
    renderLive()
    for (const [i, delay] of [1000, 2000, 4000, 8000, 8000].entries()) {
      emit('error')
      expect(reconnecting(i + 1)).toBeInTheDocument()
      await advance(delay)
    }
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(6)

    emit('error')

    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument()
    expect(screen.getByText('Stream unavailable')).toBeInTheDocument()
    expect(lastPlayer().destroy).toHaveBeenCalledTimes(1)
    await advance(60_000)
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(6)
  })
})

describe('DualModeVideoPlayer clip editor: one editor in the shell', () => {
  beforeEach(() => {
    highlight.enabled = true
  })

  // The live engine's element; the editor's preview is a <video> too
  const engineVideo = () => {
    const element = shell().querySelector<HTMLVideoElement>('video:not([aria-label="Highlight preview"])')
    if (!element) throw new Error('no engine video element')
    return element
  }

  const openEditor = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Capture clip' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create clip' })
    // The capture has arrived and the editor is streaming it
    const preview = await screen.findByLabelText('Highlight preview')
    return { dialog, preview }
  }

  it.each([
    ['live', liveChannel('https://fixture/a'), 'live-channel-0'],
    ['ErsatzTV', hlsChannel('1', 1), '1'],
  ])('%s: Capture clip opens the editor inside the shell, so it shows in fullscreen', async (_engine, channel, id) => {
    renderPlayer(channel)

    const { dialog } = await openEditor()

    expect(shell()).toContainElement(dialog)
    expect(useClipStore.getState().session).toEqual({ channelId: id, channelName: channel.name })
    expect(clipApi.createHighlightCapture).toHaveBeenCalledExactlyOnceWith(id, expect.any(AbortSignal))
  })

  it('a live channel change keeps the open editor and its capture', async () => {
    const { switchTo } = renderPlayer({ ...liveChannel('https://fixture/a'), backendId: '42' })
    const { dialog, preview } = await openEditor()
    const firstVideo = engineVideo()

    switchTo({ ...liveChannel('https://fixture/b'), backendId: '43', name: 'Post-game' })

    expect(engineVideo()).not.toBe(firstVideo)
    expect(screen.getByRole('dialog', { name: 'Create clip' })).toBe(dialog)
    expect(screen.getByLabelText('Highlight preview')).toBe(preview)
    expect(useClipStore.getState().session?.channelId).toBe('42')
    expect(clipApi.createHighlightCapture).toHaveBeenCalledTimes(1)
    expect(clipApi.deleteHighlightCapture).not.toHaveBeenCalled()
  })

  it('tells the viewer when live TV changes under the open editor', async () => {
    const { switchTo } = renderPlayer({ ...liveChannel('https://fixture/a'), name: 'Sportsnet', backendId: '42' })
    await openEditor()
    expect(screen.queryByText(/Live TV changed/)).not.toBeInTheDocument()

    switchTo({ ...liveChannel('https://fixture/b'), name: 'Post-game', backendId: '43' })

    expect(screen.getByText('Live TV changed to Post-game. Your clip from Sportsnet is kept.')).toBeInTheDocument()
  })

  it('tells the viewer when live TV stops under the open editor', async () => {
    const { switchTo } = renderPlayer({ ...liveChannel('https://fixture/a'), name: 'Sportsnet', backendId: '42' })
    await openEditor()

    switchTo(liveChannel(''))

    expect(screen.getByText('Live TV stopped. Your clip from Sportsnet is kept.')).toBeInTheDocument()
  })

  it('an HLS retry on the same channel is not a change', async () => {
    renderPlayer(hlsChannel('1', 1))
    await openEditor()
    vidstack.mounted.mockClear()

    act(() => lastPlayerProps().onError?.())
    await waitFor(() => expect(vidstack.mounted).toHaveBeenCalledTimes(1), { timeout: 2000 })

    expect(screen.queryByText(/Live TV/)).not.toBeInTheDocument()
  })

  it('live TV stopping keeps the open editor and its capture', async () => {
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    const { dialog } = await openEditor()

    switchTo(liveChannel(''))

    expect(screen.getByRole('dialog', { name: 'Create clip' })).toBe(dialog)
    expect(clipApi.deleteHighlightCapture).not.toHaveBeenCalled()
  })

  it('an HLS retry keeps the open editor and its capture', async () => {
    renderPlayer(hlsChannel('1', 1))
    const { dialog } = await openEditor()
    vidstack.mounted.mockClear()

    act(() => lastPlayerProps().onError?.())
    await waitFor(() => expect(vidstack.mounted).toHaveBeenCalledTimes(1), { timeout: 2000 })

    expect(screen.getByRole('dialog', { name: 'Create clip' })).toBe(dialog)
    expect(clipApi.createHighlightCapture).toHaveBeenCalledTimes(1)
    expect(clipApi.deleteHighlightCapture).not.toHaveBeenCalled()
    // The remounted player starts silent under the open editor
    expect(lastPlayerProps().muted).toBe(true)
  })

  it('the preview hold keeps the new engine silent after a live change and never writes audio-storage', async () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    vi.mocked(localStorage.setItem).mockClear()
    await openEditor()
    expect(engineVideo().muted).toBe(true)

    switchTo(liveChannel('https://fixture/b'))
    expect(engineVideo().muted).toBe(true)
    expect(useAudioStore.getState().muted).toBe(false)

    // The capture isn't ready, so the editor closes without asking
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(engineVideo().muted).toBe(false)
    expect(engineVideo().volume).toBe(0.3)
    expect(wroteAudioStorage()).toBe(false)
  })

  it('closing the editor ends the session and deletes the capture', async () => {
    renderPlayer(liveChannel('https://fixture/a'))
    await openEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useClipStore.getState().session).toBeNull()
    expect(clipApi.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
  })

  it('the player going away closes the editor, so it does not reopen on the next player', async () => {
    const { unmount } = renderPlayer(liveChannel('https://fixture/a'))
    await openEditor()

    unmount()

    expect(useClipStore.getState().session).toBeNull()
    expect(clipApi.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('capture-1')
    expect(useAudioStore.getState().previewHolds).toBe(0)
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

  it('renders each filter once in the shell, and keeps it across a channel switch', () => {
    useFilterStore.setState({ activeFilters: ['noir'] })
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    const noir = document.querySelector('.noir-filter')
    expect(noir?.parentElement).toBe(shell())

    switchTo(hlsChannel('1', 1))

    expect(document.querySelectorAll('.noir-filter')).toHaveLength(1)
    expect(document.querySelector('.noir-filter')).toBe(noir)
  })
})

describe('DualModeVideoPlayer NHL ticker', () => {
  afterEach(() => useUIStore.setState({ isNHLOverlayVisible: false }))

  const ticker = () => screen.queryByRole('dialog', { name: 'NHL' })

  it('renders inside the shell, so it shows in fullscreen, and stays across a channel switch', () => {
    useUIStore.setState({ isNHLOverlayVisible: true })
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))

    const first = ticker()
    expect(shell()).toContainElement(first)
    expect(first).toHaveTextContent('No games today')

    switchTo(hlsChannel('1', 1))
    expect(ticker()).toBe(first)
    expect(shell()).toContainElement(ticker())
  })

  it('follows the NHL toggle', () => {
    renderPlayer(liveChannel('https://fixture/a'))
    expect(ticker()).not.toBeInTheDocument()

    act(() => useUIStore.getState().toggleNHLOverlay())
    expect(shell()).toContainElement(ticker())

    act(() => useUIStore.getState().toggleNHLOverlay())
    expect(ticker()).not.toBeInTheDocument()
  })

  it('shows over the empty live slot too', () => {
    useUIStore.setState({ isNHLOverlayVisible: true })
    renderPlayer(liveChannel(''))

    expect(screen.getByText('No live broadcast')).toBeInTheDocument()
    expect(shell()).toContainElement(ticker())
  })
})

describe('DualModeVideoPlayer info rail', () => {
  const rail = () => screen.getByTestId('player-info-rail')

  it('renders inside the shell, so it shows in fullscreen, and survives a live channel change', () => {
    const { switchTo } = renderPlayer({ ...liveChannel('https://fixture/a'), name: 'TSN 5' })
    const first = rail()
    const firstVideo = video()
    expect(shell()).toContainElement(first)
    expect(first).toHaveTextContent('TSN 5')

    switchTo({ ...liveChannel('https://fixture/b'), name: 'Sportsnet One' })

    expect(video()).not.toBe(firstVideo)
    expect(rail()).toBe(first)
    expect(shell()).toContainElement(rail())
    expect(rail()).toHaveTextContent('Sportsnet One')
  })

  // env() is viewport-wide: inline under the page header (phone portrait) the
  // notch is the header's, and adding it again would push the rail and what
  // sits under it into the picture
  it('takes the safe-area top inset only when the shell is at the top of the viewport', () => {
    const insetTop = () => shell().style.getPropertyValue('--player-inset-top')
    const channel = liveChannel('https://fixture/a')
    const { rerender } = render(
      <DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={vi.fn()} />
    )
    expect(insetTop()).toBe('0px')
    expect(rail().className).not.toContain('safe-area-inset-top')
    expect(rail()).toHaveClass('pt-[calc(0.75rem+var(--player-inset-top,0px))]')

    rerender(<DualModeVideoPlayer channel={channel} isTheaterMode={true} onTheaterModeToggle={vi.fn()} />)
    expect(insetTop()).toBe('env(safe-area-inset-top, 0px)')

    rerender(<DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={vi.fn()} />)
    expect(insetTop()).toBe('0px')
    try {
      act(() => {
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: shell() })
        document.dispatchEvent(new Event('fullscreenchange'))
      })
      expect(insetTop()).toBe('env(safe-area-inset-top, 0px)')
    } finally {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    }
  })

  it('announces a live-channel change inside the shell, across the engine swap it causes', () => {
    const { switchTo } = renderPlayer({ ...liveChannel('https://fixture/a'), name: 'TSN 5' })

    act(() => useChannelStore.getState().setLastChange({ by: 'jon', at: Date.now(), channelName: 'Sportsnet One' }))
    switchTo({ ...liveChannel('https://fixture/b'), name: 'Sportsnet One' })

    const status = screen.getByRole('status')
    expect(shell()).toContainElement(status)
    expect(status).toHaveTextContent('Live changed to Sportsnet One by jon')
    act(() => useChannelStore.setState({ lastChange: null }))
  })

  it('keeps the sound-off pill under the rail while the rail is up, and back at the top when it hides', () => {
    vi.useFakeTimers()
    try {
      useAudioStore.setState({ volume: 0.3, muted: true, savedMuteNotice: true })
      renderPlayer(liveChannel('https://fixture/a'))
      act(() => {
        video().dispatchEvent(new Event('playing'))
      })
      const notice = soundOffNotice()
      expect(rail()).toHaveClass('opacity-100')
      expect(notice).toHaveClass('top-[calc(4.25rem+var(--player-inset-top,0px))]')
      expect(notice).not.toHaveClass('top-4')

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(rail()).toHaveClass('opacity-0')
      expect(soundOffNotice()).toHaveClass('top-4')
    } finally {
      vi.useRealTimers()
    }
  })

  it('follows the shell\'s control visibility', () => {
    vi.useFakeTimers()
    try {
      renderPlayer(liveChannel('https://fixture/a'))
      act(() => {
        video().dispatchEvent(new Event('playing'))
      })
      expect(rail()).toHaveClass('opacity-100')

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(shellProbe.current?.controlsVisible).toBe(false)
      expect(rail()).toHaveClass('opacity-0')
    } finally {
      vi.useRealTimers()
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

describe('DualModeVideoPlayer: a page load that starts from a saved mute', () => {
  // What audioStore sets up when the page loads with a saved mute
  const loadSavedMute = (volume: number) => useAudioStore.setState({ volume, muted: true, savedMuteNotice: true })

  const engines = [
    [
      'live',
      liveChannel('https://fixture/a'),
      liveChannel('https://fixture/b'),
      () =>
        act(() => {
          video().dispatchEvent(new Event('playing'))
        }),
      () => expect(video().muted).toBe(false),
    ],
    [
      'ErsatzTV',
      hlsChannel('1', 1),
      hlsChannel('2', 2),
      () => act(() => lastPlayerProps().onPlaying?.()),
      () => {
        expect(lastPlayerProps().muted).toBe(false)
        expect(vidstack.remote.unmute).toHaveBeenCalled()
      },
    ],
  ] as const

  it.each(engines)(
    '%s: says the sound is off once playback starts, and the notice unmutes at the saved level',
    (_engine, channel, _next, startPlayback, expectElementUnmuted) => {
      loadSavedMute(0.3)
      renderPlayer(channel)
      expect(soundOffNotice()).not.toBeInTheDocument()

      startPlayback()
      const notice = soundOffNotice()
      expect(notice).toHaveTextContent('Restore 30%')
      // Under the info rail, which is up for the tune
      expect(notice).toHaveClass('top-[calc(4.25rem+var(--player-inset-top,0px))]', 'left-1/2')

      fireEvent.click(notice!)

      expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: false, savedMuteNotice: false })
      expectElementUnmuted()
      expect(soundOffNotice()).not.toBeInTheDocument()
    }
  )

  it.each(engines)(
    '%s: names the level unmuting gives when the saved one is barely audible',
    (_engine, channel, _next, startPlayback) => {
      loadSavedMute(0.05)
      renderPlayer(channel)
      startPlayback()

      expect(soundOffNotice()).toHaveTextContent('Restore 25%')
      fireEvent.click(soundOffNotice()!)
      expect(useAudioStore.getState()).toMatchObject({ volume: 0.25, muted: false })
    }
  )

  it.each(engines)(
    '%s: on iOS, where script volume is ignored, offers Turn sound on instead of a level',
    (_engine, channel, _next, startPlayback) => {
      volumeSupport.canSet = false
      loadSavedMute(0.3)
      renderPlayer(channel)
      startPlayback()

      expect(soundOffNotice()).toHaveTextContent('Turn sound on')
      fireEvent.click(soundOffNotice()!)
      expect(useAudioStore.getState().muted).toBe(false)
    }
  )

  it.each(engines)('%s: shows it once per page load, not again after a channel switch', (_engine, channel, next, startPlayback) => {
    loadSavedMute(0.3)
    const { switchTo } = renderPlayer(channel)
    startPlayback()
    expect(soundOffNotice()).toBeInTheDocument()

    switchTo(next)
    startPlayback()

    expect(soundOffNotice()).not.toBeInTheDocument()
    expect(useAudioStore.getState().muted).toBe(true)
  })

  it.each(engines)('%s: goes when the viewer unmutes another way, and a later mute gets no notice', (_engine, channel, _next, startPlayback) => {
    loadSavedMute(0.3)
    renderPlayer(channel)
    startPlayback()
    expect(soundOffNotice()).toBeInTheDocument()

    // Both bars name the level ('Unmute (30%)')
    fireEvent.click(screen.getByRole('button', { name: /^Unmute/ }))
    expect(soundOffNotice()).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(useAudioStore.getState().muted).toBe(true)
    expect(soundOffNotice()).not.toBeInTheDocument()
  })

  it.each(engines)('%s: a mute made during the session gets no notice', (_engine, channel, _next, startPlayback) => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(channel)

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    startPlayback()

    expect(useAudioStore.getState().muted).toBe(true)
    expect(soundOffNotice()).not.toBeInTheDocument()
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

describe('DualModeVideoPlayer auto-hide: one visibility in the shell', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const toolbar = () => screen.getByRole('toolbar', { name: 'Video controls' })
  const startLive = () =>
    act(() => {
      video().dispatchEvent(new Event('playing'))
    })
  const waitOut = () =>
    act(() => {
      vi.advanceTimersByTime(5000)
    })

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: the control bar shows and hides with the shell', (engine, channel) => {
    renderPlayer(channel)
    if (engine === 'live') startLive()
    expect(shellProbe.current?.controlsVisible).toBe(true)

    waitOut()

    expect(shellProbe.current?.controlsVisible).toBe(false)
    expect(toolbar()).toHaveClass('opacity-0')
  })

  it('hides the pointer over the playing live picture with the controls', () => {
    renderPlayer(liveChannel('https://fixture/a'))
    startLive()
    expect(video().parentElement).not.toHaveClass('cursor-none')

    waitOut()

    expect(video().parentElement).toHaveClass('cursor-none')
  })

  it('a new stream brings the controls back until it plays', () => {
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    startLive()
    waitOut()
    expect(toolbar()).toHaveClass('opacity-0')

    switchTo(liveChannel('https://fixture/b'))
    expect(toolbar()).toHaveClass('opacity-100')

    startLive()
    waitOut()
    expect(toolbar()).toHaveClass('opacity-0')
  })

  it('the pointer over the bar keeps it up, and a channel change under it does not pin it', () => {
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    startLive()
    fireEvent.mouseEnter(toolbar())
    waitOut()
    expect(toolbar()).toHaveClass('opacity-100')

    // The old bar goes without a mouseleave
    switchTo(liveChannel('https://fixture/b'))
    startLive()
    waitOut()

    expect(toolbar()).toHaveClass('opacity-0')
  })
})

describe('DualModeVideoPlayer before a channel is selected', () => {
  it("says 'Tuning in...' with a spinner that only moves when motion is allowed", () => {
    render(<DualModeVideoPlayer channel={null} isTheaterMode={false} onTheaterModeToggle={vi.fn()} />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Tuning in...')
    expect(shell()).toContainElement(status)
    const spinner = status.querySelector('svg')
    expect(spinner).toHaveClass('motion-safe:animate-spin')
    expect(spinner).not.toHaveClass('animate-spin')
    expect(spinner).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText(/Select a channel/)).not.toBeInTheDocument()
  })
})

describe('DualModeVideoPlayer empty live slot', () => {
  afterEach(() => useChannelStore.setState({ lastChange: null }))

  const renderEmptySlot = (onPickLive?: () => void) =>
    render(
      <DualModeVideoPlayer
        channel={liveChannel('')}
        isTheaterMode={false}
        onTheaterModeToggle={vi.fn()}
        onPickLive={onPickLive}
      />
    )

  it('offers Pick a channel for everyone to people allowed to change live TV', () => {
    const onPickLive = vi.fn()
    renderEmptySlot(onPickLive)

    expect(screen.getByText('No live broadcast')).toBeInTheDocument()
    const pick = screen.getByRole('button', { name: 'Pick a channel for everyone' })
    expect(pick).toHaveClass('h-10', 'bg-primary')
    fireEvent.click(pick)
    expect(onPickLive).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Waiting for someone to put something on')).not.toBeInTheDocument()
  })

  it('tells everyone else they are waiting, without blaming the admin', () => {
    renderEmptySlot()

    expect(screen.getByText('Waiting for someone to put something on')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pick a channel for everyone' })).not.toBeInTheDocument()
    expect(screen.queryByText(/admin/i)).not.toBeInTheDocument()
  })

  it('says who stopped live TV', () => {
    useChannelStore.setState({ lastChange: { by: 'alice', at: 1000, channelName: null } })
    renderEmptySlot()

    expect(screen.getByText('alice stopped live TV')).toBeInTheDocument()
  })

  it('names nobody when the stop came from the system', () => {
    useChannelStore.setState({ lastChange: { by: null, at: 1000, channelName: null } })
    renderEmptySlot(vi.fn())

    expect(screen.queryByText(/stopped live TV/)).not.toBeInTheDocument()
  })

  it('names nobody when the last change put a channel on', () => {
    useChannelStore.setState({ lastChange: { by: 'alice', at: 1000, channelName: 'ESPN' } })
    renderEmptySlot()

    expect(screen.queryByText(/stopped live TV/)).not.toBeInTheDocument()
  })
})
