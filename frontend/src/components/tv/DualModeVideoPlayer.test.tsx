import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode, Ref } from 'react'
import { render, renderHook, screen, fireEvent, act, waitFor, within } from '@/test/utils'
import { DualModeVideoPlayer } from './DualModeVideoPlayer'
import { ARRIVAL_SHOWN_KEY } from './ArrivalCard'
import { useAudioStore } from '@/stores/audioStore'
import { useFilterStore } from '@/stores/filterStore'
import { useChannelStore } from '@/stores/channelStore'
import { useUIStore } from '@/stores/uiStore'
import { useClipStore } from '@/stores/clipStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import { useChatStore } from '@/stores/chatStore'
import { INITIAL_CAST_STATE, useCastStore } from '@/stores/castStore'
import { useChannelZap, type ChannelZap } from '@/hooks/useChannelZap'
import { usePlayerFullscreenElement } from '@/hooks/useFullscreenState'
import type { UnifiedChannel } from '@/types'
import type { NHLGame } from '@/types/nhl'
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
  // The media data source, and the config when there is one
  const createPlayer = vi.fn<(source: unknown, config?: unknown) => StubPlayer>(() => {
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
  autoPlay?: boolean
  keyDisabled?: boolean
  onError?: () => void
  onPlaying?: () => void
  onPlay?: () => void
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
    seekToLiveEdge: vi.fn(),
    play: vi.fn(),
  }
  const harness = {
    mediaPlayer: vi.fn<(props: Record<string, unknown>) => void>(),
    mounted: vi.fn(),
    // Vidstack reports a placeholder volume of 1 until can-play
    state: { paused: false, volume: 1, muted: false, fullscreen: false, canPlay: false } as Record<string, unknown>,
    remote,
    // The provider under the player (its seeks skip Vidstack's own checks)
    provider: { setCurrentTime: vi.fn<(time: number) => void>() },
    // What the MediaPlayer ref (and useMediaPlayer) exposes
    player: {
      play: vi.fn<() => Promise<void>>(),
      pause: vi.fn(),
      remoteControl: remote,
      get state() {
        return harness.state
      },
      get provider() {
        return harness.provider
      },
      listen: () => () => {},
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
    useMediaPlayer: () => vidstack.player,
  }
})

// A recording channel with a clip's worth of buffer, unless a test says otherwise
const readyBuffer = { enabled: true, recording: true, bufferSeconds: 30, maxBufferSeconds: 60 }
const highlight = vi.hoisted(() => ({
  enabled: false,
  status: { enabled: true, recording: true, bufferSeconds: 30, maxBufferSeconds: 60 },
}))
vi.mock('@/hooks/useHighlightFeature', () => ({
  useHighlightFeature: () => ({ isEnabled: highlight.enabled, isLoading: false }),
}))
vi.mock('@/hooks/useHighlightStatus', () => ({
  useHighlightStatus: () => ({ status: highlight.status, loaded: true }),
}))
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
const castFeature = vi.hoisted(() => vi.fn(() => new Promise<boolean>(() => {})))
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  ...clipApi,
  highlightCaptureUrl: (id: string) => `/api/highlight/capture/${id}`,
  // The TV store looks the live guide up when live TV changes; never answered here
  fetchNowPlaying: () => new Promise(() => {}),
  fetchLiveProgrammes: () => new Promise(() => {}),
  // The shell holds the Cast SDK, which starts with this check; never answered here
  getCastFeatureEnabled: castFeature,
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

// The NHL ticker's scores: a day with no games unless a test adds some, so
// nothing is fetched
const nhlScores = vi.hoisted(() => ({ games: [] as NHLGame[] }))
vi.mock('@/hooks/useNHLScores', () => ({
  useNHLScores: () => ({
    data: { games: nhlScores.games, date: '2026-09-27', liveGameCount: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

// Script volume detection (false on iOS/iPadOS Safari)
const volumeSupport = vi.hoisted(() => ({ canSet: true }))
vi.mock('@/hooks/useCanSetVolume', () => ({ useCanSetVolume: () => volumeSupport.canSet }))

// VITE_CHAT_ENABLED: off unless a test turns it on
const chatFeature = vi.hoisted(() => ({ enabled: false }))
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => chatFeature.enabled }))

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

const nhlGame = (id: number): NHLGame => ({
  id,
  status: 'scheduled',
  homeTeam: { name: `Home ${id}`, abbreviation: `H${id}`, score: 0, logo: '', logoDark: '' },
  awayTeam: { name: `Away ${id}`, abbreviation: `A${id}`, score: 0, logo: '', logoDark: '' },
  startTime: '2026-09-27T23:00:00Z',
  gameCenterLink: 'https://nhl.com/gamecenter/test',
  broadcasts: [],
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
  // The arrival card has had its turn this session, so it stays out of the
  // way (its own suite, and one test below, cover it)
  sessionStorage.clear()
  sessionStorage.setItem(ARRIVAL_SHOWN_KEY, '1')
  useAudioStore.setState({ volume: 1, muted: false, savedMuteNotice: false, previewHolds: 0 })
  useFilterStore.setState({ activeFilters: [] })
  vidstack.state = { paused: false, volume: 1, muted: false, fullscreen: false, canPlay: false }
  vidstack.mediaPlayer.mockClear()
  vidstack.mounted.mockClear()
  Object.values(vidstack.remote).forEach((fn) => fn.mockClear())
  vidstack.player.play.mockReset().mockResolvedValue(undefined)
  vidstack.player.pause.mockClear()
  highlight.enabled = false
  highlight.status = readyBuffer
  useClipStore.setState({ session: null })
  clipApi.createHighlightCapture.mockReset().mockResolvedValue({ id: 'capture-1' })
  clipApi.deleteHighlightCapture.mockReset().mockResolvedValue(undefined)
  clipApi.getHighlightFeatures.mockReset().mockResolvedValue({ enabled: true, ziplineEnabled: false })
  volumeSupport.canSet = true
  chatFeature.enabled = false
  nhlScores.games = []
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

describe('DualModeVideoPlayer live catch-up (mpegts liveSync)', () => {
  it('plays a little faster to close small drifts outside TV mode', () => {
    renderPlayer(liveChannel('https://fixture/a'))

    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(1)
    expect(mpegtsHarness.createPlayer.mock.lastCall).toEqual([
      { type: 'mpegts', isLive: true, url: 'https://fixture/a' },
      { liveSync: true, liveSyncMaxLatency: 5, liveSyncTargetLatency: 3, liveSyncPlaybackRate: 1.1 },
    ])
  })

  it('leaves the playback rate alone in TV mode', () => {
    localStorage.setItem('tv-mode', 'true')
    renderPlayer(liveChannel('https://fixture/a'))

    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(1)
    const [source, config] = mpegtsHarness.createPlayer.mock.lastCall ?? []
    expect(source).toEqual({ type: 'mpegts', isLive: true, url: 'https://fixture/a' })
    expect(config).toBeUndefined()
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

  it("a TV remote's play/pause key drives Vidstack, and only on a TV", () => {
    const offTV = renderPlayer(hlsChannel('1', 1))
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 10252 })
    expect(vidstack.remote.togglePaused).not.toHaveBeenCalled()
    offTV.unmount()

    localStorage.setItem('tv-mode', 'true')
    renderPlayer(hlsChannel('1', 1))
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 10252 })

    expect(vidstack.remote.togglePaused).toHaveBeenCalledTimes(1)
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

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: M and T work after picking a channel in the sidebar, the arrows stay with the list', (_engine, channel) => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    const onTheaterModeToggle = vi.fn()
    render(
      <>
        <ul>
          <li>
            <button type="button">Channel 2</button>
          </li>
        </ul>
        <DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={onTheaterModeToggle} />
      </>
    )
    const row = screen.getByRole('button', { name: 'Channel 2' })
    row.focus()

    fireEvent.keyDown(row, { key: 'ArrowDown' })
    fireEvent.keyDown(row, { key: 'm' })
    fireEvent.keyDown(row, { key: 't' })

    expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: true })
    expect(onTheaterModeToggle).toHaveBeenCalledTimes(1)
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

  // The page finds it by the mark to portal chat and toasts into it
  it('marks the shell for the page to find in fullscreen', () => {
    renderPlayer(liveChannel('https://fixture/a'))
    setFullscreenElement(shell())

    const { result } = renderHook(() => usePlayerFullscreenElement())
    expect(result.current).toBe(shell())
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
  ])('%s: on a TV that looks like a touch device, Fullscreen stays and fullscreens the shell, with no Theater', (_engine, channel) => {
    // webOS pointer mode can report pointer:coarse, so TV mode must win
    localStorage.setItem('tv-mode', 'true')
    matchMediaQueries(['(pointer: coarse)'])
    const original = HTMLElement.prototype.requestFullscreen
    const requestFullscreen = vi.fn(() => Promise.resolve())
    HTMLElement.prototype.requestFullscreen = requestFullscreen
    try {
      renderPlayer(channel)

      // The couch layout always fills the screen
      expect(screen.queryByRole('button', { name: /theater/i })).not.toBeInTheDocument()
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

  // The page shrinks it to a strip above the phone's chat composer; the
  // chrome inside reads that from the shell
  it('tells the shell whether the page has shrunk it to a strip', () => {
    const channel = liveChannel('https://fixture/a')
    const { rerender } = render(
      <DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={vi.fn()} />
    )
    expect(shellProbe.current?.isStrip).toBe(false)

    rerender(<DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={vi.fn()} isStrip />)
    expect(shellProbe.current?.isStrip).toBe(true)
    expect(screen.getByRole('toolbar', { name: 'Video controls' })).toHaveClass('p-1.5')
  })

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: the bar\'s Reload and the R key re-initialise only the engine', (_engine, channel) => {
    renderPlayer(channel)
    const fullscreen = enterFullscreen()
    const firstVideo = document.querySelector('video')
    vidstack.mounted.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Reload stream' }))
    if (channel.type === 'live') expect(video()).not.toBe(firstVideo)
    else expect(vidstack.mounted).toHaveBeenCalledTimes(1)
    const secondVideo = document.querySelector('video')

    fireEvent.keyDown(window, { key: 'r' })
    if (channel.type === 'live') expect(video()).not.toBe(secondVideo)
    else expect(vidstack.mounted).toHaveBeenCalledTimes(2)

    expect(shell()).toBe(fullscreen)
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
  })

  it('ErsatzTV: says the stream is starting until it has played, then reconnecting, from 1 of 5', async () => {
    vi.useFakeTimers()
    try {
      renderPlayer(hlsChannel('1', 1))

      act(() => lastPlayerProps().onError?.())
      expect(screen.getByText('Starting stream... 1 of 5')).toBeInTheDocument()
      await act(() => vi.advanceTimersByTimeAsync(1000))
      act(() => lastPlayerProps().onError?.())
      expect(screen.getByText('Starting stream... 2 of 5')).toBeInTheDocument()
      await act(() => vi.advanceTimersByTimeAsync(2000))

      act(() => lastPlayerProps().onPlaying?.())
      expect(screen.queryByText(/of 5/)).not.toBeInTheDocument()
      act(() => lastPlayerProps().onError?.())

      expect(screen.getByText('Reconnecting... 1 of 5')).toBeInTheDocument()
      // Non-blocking: the pill lets taps through to the controls under it
      expect(screen.getByText('Reconnecting... 1 of 5').closest('[role="status"]')).toHaveClass('pointer-events-none')
      expect(screen.getByRole('toolbar', { name: 'Video controls' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ErsatzTV: when the retries stop, the card shows in the same shell over the player and its controls', async () => {
    vi.useFakeTimers()
    try {
      renderPlayer(hlsChannel('1', 1))
      const fullscreen = enterFullscreen()

      // useStreamRecovery gives up after its reconnects
      for (let i = 0; i < 10 && !screen.queryByText('Stream stopped'); i++) {
        act(() => lastPlayerProps().onError?.())
        await act(() => vi.advanceTimersByTimeAsync(8000))
      }

      expect(screen.getByText('Stream stopped')).toBeInTheDocument()
      expect(screen.queryByText(/Select another channel/)).not.toBeInTheDocument()
      expect(shell()).toBe(fullscreen)
      expect(fullscreen).toContainElement(screen.getByText('Stream stopped'))
      expect(fullscreen).toContainElement(document.querySelector<HTMLElement>('[data-media-player]'))
      expect(screen.getByRole('toolbar', { name: 'Video controls' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()

      // Retry starts the player again with a full set of reconnects
      vidstack.mounted.mockClear()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(vidstack.mounted).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Stream stopped')).not.toBeInTheDocument()
      act(() => lastPlayerProps().onError?.())
      expect(screen.getByText('Starting stream... 1 of 5')).toBeInTheDocument()
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
    useChannelStore.setState({ currentChannel: null })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null, previousChannelId: null })
  })

  // A live channel that has been playing, unless told it hasn't started
  const renderLive = ({ started = true } = {}) => {
    const view = renderPlayer(liveChannel('https://fixture/a'))
    Object.defineProperty(video(), 'paused', { configurable: true, get: () => isPaused })
    Object.defineProperty(video(), 'currentTime', { configurable: true, get: () => currentTime })
    if (started) {
      act(() => {
        video().dispatchEvent(new Event('playing'))
      })
    }
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
    // A pill that lets taps through, over a player that keeps its controls
    expect(reconnecting(1)?.closest('[role="status"]')).toHaveClass('pointer-events-none')
    expect(screen.getByRole('toolbar', { name: 'Video controls' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(useAudioStore.getState().muted).toBe(true)
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

  it('says it is starting the stream when nothing has played yet', () => {
    renderLive({ started: false })

    emit('error')

    expect(screen.getByText('Starting stream... 1 of 5')).toBeInTheDocument()
  })

  const failFiveTimes = async () => {
    for (const [i, delay] of [1000, 2000, 4000, 8000, 8000].entries()) {
      emit('error')
      expect(reconnecting(i + 1)).toBeInTheDocument()
      await advance(delay)
    }
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(6)
    emit('error')
  }

  it('stops after 5 reconnects, letting go of the upstream, with Stream stopped in the shell', async () => {
    renderLive()

    await failFiveTimes()

    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument()
    expect(screen.getByText('Stream stopped')).toBeInTheDocument()
    expect(shell()).toContainElement(screen.getByText('Stream stopped'))
    expect(screen.queryByText(/Select another channel/)).not.toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Video controls' })).toBeInTheDocument()
    expect(lastPlayer().destroy).toHaveBeenCalledTimes(1)
    await advance(60_000)
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(6)
  })

  it('Retry starts a new player with a full set of reconnects', async () => {
    renderLive()
    await failFiveTimes()
    const element = video()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(7)
    expect(lastPlayer().attachMediaElement).toHaveBeenCalledWith(element)
    expect(screen.queryByText('Stream stopped')).not.toBeInTheDocument()
    emit('error')
    expect(reconnecting(1)).toBeInTheDocument()
  })

  it('R after the reconnects stop starts the stream again', async () => {
    renderLive()
    await failFiveTimes()

    fireEvent.keyDown(window, { key: 'R' })

    expect(screen.queryByText('Stream stopped')).not.toBeInTheDocument()
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(7)
  })

  it("'Back to' tunes this viewer to their previous channel, leaving the club's live channel alone", async () => {
    const tsn = { id: '28', name: 'TSN 5', streamUrl: 'https://fixture/a', guideId: '5' }
    useChannelStore.setState({ currentChannel: tsn })
    useErsatztvStore.setState({
      channels: [{ id: 'e2', name: 'Cartoons', number: 2, streamUrl: '/e2', logoUrl: '', group: '' }],
    })
    useTVStore.setState({ selectedChannel: liveChannel('https://fixture/a'), previousChannelId: 'e2' })
    renderLive()
    expect(screen.queryByRole('button', { name: /Back to/ })).not.toBeInTheDocument()

    await failFiveTimes()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Cartoons' }))

    expect(useTVStore.getState().selectedChannel).toMatchObject({ id: 'e2', type: 'ersatztv' })
    expect(useChannelStore.getState().currentChannel).toBe(tsn)
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

  it("opens on the capture Clip that's Edit hands over, without capturing again", async () => {
    renderPlayer({ ...liveChannel('https://fixture/a'), name: 'Sportsnet', backendId: '42' })
    const capture = { id: 'clip-that-capture', duration: 60, bytes: 1, expiresAt: 0, pressedAt: 1_000, endsAt: 1_000 }

    act(() => useClipStore.getState().open('42', 'Sportsnet', capture))

    const preview = await screen.findByLabelText('Highlight preview')
    expect(shell()).toContainElement(preview)
    expect(preview).toHaveAttribute('src', '/api/highlight/capture/clip-that-capture')
    expect(clipApi.createHighlightCapture).not.toHaveBeenCalled()

    // The capture isn't ready, so the editor closes without asking, and deletes it
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    await waitFor(() => expect(clipApi.deleteHighlightCapture).toHaveBeenCalledExactlyOnceWith('clip-that-capture'))
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

describe('DualModeVideoPlayer chat over the video', () => {
  beforeEach(() => {
    chatFeature.enabled = true
    useChatStore.setState({ messages: [], isOpen: false })
    useUIStore.setState({ chatPreviews: true })
  })

  it('shows in theater inside the shell, so it is in fullscreen too, and stays across a channel switch', () => {
    const view = render(<DualModeVideoPlayer channel={liveChannel('https://fixture/a')} isTheaterMode onTheaterModeToggle={vi.fn()} />)
    act(() => useChatStore.getState().addMessage({ messageId: 'm1', username: 'maya', content: 'goal!', timestamp: new Date().toISOString() }))

    const overlay = screen.getByTestId('chat-overlay')
    expect(shell()).toContainElement(overlay)
    expect(overlay).toHaveTextContent('maya goal!')

    view.rerender(<DualModeVideoPlayer channel={hlsChannel('1', 1)} isTheaterMode onTheaterModeToggle={vi.fn()} />)
    expect(screen.getByTestId('chat-overlay')).toBe(overlay)
    expect(overlay).toHaveTextContent('maya goal!')
  })

  describe('C in theater', () => {
    const renderTheater = () =>
      render(<DualModeVideoPlayer channel={liveChannel('https://fixture/a')} isTheaterMode onTheaterModeToggle={vi.fn()} />)
    const composer = () => screen.queryByRole('textbox', { name: 'Message the club' })

    it('opens the composer over the video, focused, rather than the panel', () => {
      renderTheater()

      fireEvent.keyDown(window, { key: 'c' })

      expect(composer()).toHaveFocus()
      expect(shell()).toContainElement(composer())
      expect(useChatStore.getState().isOpen).toBe(false)
    })

    it('Enter sends through the sender TVView registered', async () => {
      const sender = vi.fn(() => Promise.resolve('acknowledged' as const))
      const unregister = useChatStore.getState().registerSender(sender)
      renderTheater()
      fireEvent.keyDown(window, { key: 'c' })

      fireEvent.change(composer()!, { target: { value: 'what a goal' } })
      await act(async () => {
        fireEvent.submit(composer()!)
      })

      expect(sender).toHaveBeenCalledWith('what a goal', expect.any(String))
      expect(composer()).not.toBeInTheDocument()
      unregister()
    })

    it("toggles the panel as before with 'Show chat over the video' off", () => {
      useUIStore.setState({ chatPreviews: false })
      renderTheater()

      fireEvent.keyDown(window, { key: 'c' })

      expect(composer()).not.toBeInTheDocument()
      expect(useChatStore.getState().isOpen).toBe(true)
    })

    it('closes the composer when the panel opens', () => {
      renderTheater()
      fireEvent.keyDown(window, { key: 'c' })

      act(() => useChatStore.getState().setOpen(true))

      expect(composer()).not.toBeInTheDocument()
    })

    // The sheet reads the same conditions as the key
    it('the shortcut sheet says C writes over the video', () => {
      renderTheater()

      fireEvent.keyDown(window, { key: '?' })

      const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
      expect(sheet).toHaveTextContent('Write in the chat over the video')
      expect(sheet).not.toHaveTextContent('Open or close chat')
    })

    it("the shortcut sheet says C opens chat with 'Show chat over the video' off", () => {
      useUIStore.setState({ chatPreviews: false })
      renderTheater()

      fireEvent.keyDown(window, { key: '?' })

      const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
      expect(sheet).toHaveTextContent('Open or close chat')
      expect(sheet).not.toHaveTextContent('Write in the chat over the video')
    })
  })

  // The couch has no chat: C would open a hidden panel that springs open,
  // composer focused, once the TV layout is turned off
  it('C does nothing on the TV layout, leaving no chat open for later', () => {
    localStorage.setItem('tv-mode', 'true')
    render(<DualModeVideoPlayer channel={liveChannel('https://fixture/a')} isTheaterMode onTheaterModeToggle={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'c' })

    expect(useChatStore.getState().isOpen).toBe(false)
    expect(screen.queryByRole('textbox', { name: 'Message the club' })).not.toBeInTheDocument()
  })

  it('is not drawn in the page layout', () => {
    renderPlayer(liveChannel('https://fixture/a'))
    act(() => useChatStore.getState().addMessage({ messageId: 'm1', username: 'maya', content: 'goal!', timestamp: new Date().toISOString() }))

    expect(screen.queryByTestId('chat-overlay')).not.toBeInTheDocument()
  })
})

describe('DualModeVideoPlayer NHL ticker', () => {
  afterEach(() => useUIStore.setState({ isNHLOverlayVisible: false }))

  const ticker = () => screen.queryByRole('region', { name: 'NHL scores' })

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
    expect(status).toHaveTextContent('jon put on Sportsnet One')
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
    useUIStore.setState({ isNHLOverlayVisible: false })
    delete (Element.prototype as Partial<Element>).scrollBy
  })

  const toolbar = () => screen.getByRole('toolbar', { name: 'Video controls' })
  const picture = () => {
    const element = document.querySelector('video') ?? document.querySelector('[data-media-player]')
    if (!element) throw new Error('no picture')
    return element
  }

  // What a browser fires for one tap, in order. Each is a separate discrete
  // event, so React renders between them.
  const tap = (target: () => Element) => {
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
        target().dispatchEvent(event)
      })
    }
  }
  const tapPicture = () => tap(picture)

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

  it('a tap on a chevron of the NHL ticker scrolls the games and leaves the controls up', () => {
    // Twelve games in a row that holds about three, so the right chevron shows.
    // jsdom has no layout scrolling, so there is no scrollBy to spy on.
    nhlScores.games = Array.from({ length: 12 }, (_, i) => nhlGame(i + 1))
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(1200)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(300)
    const scrollBy = vi.fn()
    Element.prototype.scrollBy = scrollBy
    useUIStore.setState({ isNHLOverlayVisible: true })
    renderPlayer(hlsChannel('1', 1))
    expect(toolbar()).toHaveClass('opacity-100')

    tap(() => screen.getByRole('button', { name: 'Scroll games right' }))

    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(toolbar()).toHaveClass('opacity-100')
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

  // The element around the engine, which carries the shell's pointer rule
  const engineFrame = () => {
    const frame = shell().querySelector('[data-media-player], video')?.closest('.video-player-container > div')
    if (!frame) throw new Error('no engine frame')
    return frame
  }

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: hides the pointer over the playing picture with the controls', (engine, channel) => {
    renderPlayer(channel)
    if (engine === 'live') startLive()
    expect(engineFrame()).not.toHaveClass('cursor-none')

    waitOut()

    expect(engineFrame()).toHaveClass('cursor-none')
  })

  it('keeps the pointer while the ErsatzTV picture is paused', () => {
    vidstack.state = { ...vidstack.state, paused: true }
    renderPlayer(hlsChannel('1', 1))

    waitOut()

    expect(engineFrame()).not.toHaveClass('cursor-none')
  })

  it('brings the pointer back with the controls', () => {
    renderPlayer(hlsChannel('1', 1))
    waitOut()
    expect(engineFrame()).toHaveClass('cursor-none')

    act(() => {
      shell().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 40 }))
    })

    expect(engineFrame()).not.toHaveClass('cursor-none')
  })

  it('leaves the shell itself alone: the clip editor and shortcut sheet portal into it and keep the pointer', () => {
    renderPlayer(hlsChannel('1', 1))
    waitOut()

    expect(engineFrame()).toHaveClass('cursor-none')
    expect(shell()).not.toHaveClass('cursor-none')
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

  // The couch's remote can't reach the bar: only a pointer brings it up
  describe('TV mode', () => {
    beforeEach(() => {
      localStorage.setItem('tv-mode', 'true')
    })

    it('keeps the bar off the picture on mount, when playback starts, on a key press and across a zap', () => {
      const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
      expect(toolbar()).toHaveClass('opacity-0')

      startLive()
      expect(toolbar()).toHaveClass('opacity-0')

      fireEvent.keyDown(window, { key: 'm' })
      expect(toolbar()).toHaveClass('opacity-0')

      // The old engine reports stopped as it goes, the new one plays
      switchTo(liveChannel('https://fixture/b'))
      expect(toolbar()).toHaveClass('opacity-0')
      startLive()
      expect(toolbar()).toHaveClass('opacity-0')
    })

    it('a Magic Remote pointer move brings the bar up, and it hides 3s later', () => {
      renderPlayer(liveChannel('https://fixture/a'))
      startLive()

      act(() => {
        shell().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 40 }))
      })
      expect(toolbar()).toHaveClass('opacity-100')

      waitOut()
      expect(toolbar()).toHaveClass('opacity-0')
    })
  })
})

describe('DualModeVideoPlayer arrival card', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useUIStore.setState({ hasSeenWelcome: false })
    // A desktop-sized player, with room for the card under the info rail,
    // which is up for the tune
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(432)
  })

  const arrivalCard = () => screen.getByTestId('arrival-card')

  it('greets a first-time viewer inside the shell, and it stays up across a channel change', () => {
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))

    const card = screen.getByTestId('arrival-card')
    expect(shell()).toContainElement(card)
    expect(card).toHaveTextContent('Channel 0 is the club channel')

    switchTo(liveChannel('https://fixture/b'))
    expect(screen.getByTestId('arrival-card')).toHaveTextContent('Channel 0 is the club channel')
  })

  it('on a phone in portrait sits in the page under the player, clear of the picture and the rail', () => {
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(211)
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(
      <DualModeVideoPlayer
        channel={hlsChannel('1', 1)}
        isTheaterMode={false}
        onTheaterModeToggle={vi.fn()}
        arrivalHost={host}
      />
    )

    const card = arrivalCard()
    expect(host).toContainElement(card)
    expect(shell()).not.toContainElement(card)
    expect(card).not.toHaveClass('absolute')
    expect(card).toHaveTextContent('Channel 0 is the club channel')
    // The rail's NHL button is in the shell, so nothing covers it
    expect(shell()).toContainElement(screen.getByRole('button', { name: /NHL/ }))
    host.remove()
  })

  it("under the player it still waits while 'Sound is off' is up", () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    useAudioStore.setState({ volume: 0.3, muted: true, savedMuteNotice: true })
    render(
      <DualModeVideoPlayer
        channel={hlsChannel('1', 1)}
        isTheaterMode={false}
        onTheaterModeToggle={vi.fn()}
        arrivalHost={host}
      />
    )
    act(() => lastPlayerProps().onPlaying?.())

    expect(soundOffNotice()).toBeInTheDocument()
    expect(arrivalCard()).toBeEmptyDOMElement()
    fireEvent.click(soundOffNotice()!)
    expect(arrivalCard()).toHaveTextContent('Channel 0 is the club channel')
    expect(host).toContainElement(arrivalCard())
    host.remove()
  })

  it.each([
    ['live', liveChannel('https://fixture/a'), () => act(() => video().dispatchEvent(new Event('playing')))],
    ['ErsatzTV', hlsChannel('1', 1), () => act(() => lastPlayerProps().onPlaying?.())],
  ] as const)(
    "%s: waits while 'Sound is off' is up, so it never covers the tap that brings the sound back",
    (_engine, channel, startPlayback) => {
      useAudioStore.setState({ volume: 0.3, muted: true, savedMuteNotice: true })
      renderPlayer(channel)
      startPlayback()

      expect(soundOffNotice()).toBeInTheDocument()
      expect(arrivalCard()).toBeEmptyDOMElement()

      fireEvent.click(soundOffNotice()!)

      expect(soundOffNotice()).not.toBeInTheDocument()
      expect(arrivalCard()).toHaveTextContent('Channel 0 is the club channel')
    }
  )

  describe('on a player too short for it under the info rail', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    // Playing, past the tune banner and the controls' auto-hide: the rail is down
    const renderIdlePlayer = () => {
      renderPlayer(hlsChannel('1', 1))
      act(() => lastPlayerProps().onPlaying?.())
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(screen.getByTestId('player-info-rail')).toHaveClass('opacity-0')
      expect(arrivalCard()).toHaveTextContent('Channel 0 is the club channel')
    }

    it('stays reachable with a mouse and the keyboard on a laptop with the guide open', () => {
      vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(290)
      renderIdlePlayer()

      // Reaching for the card raises the controls and the rail
      act(() => {
        shell().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 40 }))
      })
      expect(screen.getByTestId('player-info-rail')).toHaveClass('opacity-100')
      expect(arrivalCard()).toHaveTextContent('Channel 0 is the club channel')

      fireEvent.keyDown(window, { key: 'Tab' })
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      const close = screen.getByRole('button', { name: 'Close' })
      close.focus()
      expect(close).toHaveFocus()
      fireEvent.click(close)
      expect(screen.queryByTestId('arrival-card')).not.toBeInTheDocument()
      expect(useUIStore.getState().hasSeenWelcome).toBe(true)
    })

    it('takes a tap on a phone, though the tap raises the rail', () => {
      vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(211)
      matchMediaQueries(['(pointer: coarse)'])
      useUIStore.setState({ isEPGVisible: false })
      renderIdlePlayer()

      const browse = screen.getByRole('button', { name: 'Browse channels' })
      const tap = { bubbles: true, pointerType: 'touch', clientX: 40, clientY: 100 }
      act(() => {
        browse.dispatchEvent(new PointerEvent('pointerdown', tap))
        browse.dispatchEvent(new PointerEvent('pointerup', tap))
      })
      expect(screen.getByTestId('player-info-rail')).toHaveClass('opacity-100')
      // The click that follows the tap still finds the button
      expect(browse).toBeInTheDocument()
      fireEvent.click(browse)
      expect(useUIStore.getState().isEPGVisible).toBe(true)
    })
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

  it('carries the hook the couch sizes it by', () => {
    renderEmptySlot(vi.fn())

    expect(screen.getByText('No live broadcast').closest('.live-slot-idle')).toContainElement(
      screen.getByRole('button', { name: 'Pick a channel for everyone' })
    )
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

describe('DualModeVideoPlayer channel keys', () => {
  const fakeZap = (pending: UnifiedChannel | null = null): ChannelZap => ({
    pending,
    step: vi.fn(),
    tuneLast: vi.fn(),
    entry: null,
    missing: null,
    digit: vi.fn(),
    commitDigits: vi.fn(() => true),
  })

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
    ['the empty live slot', liveChannel('')],
  ])('%s: PageUp/PageDown and ]/[ step the channel and L goes back', (_what, channel) => {
    const zap = fakeZap()
    render(<DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={vi.fn()} zap={zap} />)

    for (const key of ['PageUp', 'PageDown', ']', '[']) fireEvent.keyDown(window, { key })
    fireEvent.keyDown(window, { key: 'l' })

    expect(vi.mocked(zap.step).mock.calls).toEqual([[1], [-1], [1], [-1]])
    expect(zap.tuneLast).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
    ['the empty live slot', liveChannel('')],
  ])('%s: digits build a channel number and Enter commits it', (_what, channel) => {
    const zap = fakeZap()
    render(<DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={vi.fn()} zap={zap} />)

    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: '2' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(vi.mocked(zap.digit).mock.calls).toEqual([['1'], ['2']])
    expect(zap.commitDigits).toHaveBeenCalledTimes(1)
  })

  it("says 'No channel 99' in the info rail", () => {
    render(
      <DualModeVideoPlayer
        channel={hlsChannel('1', 1)}
        isTheaterMode={false}
        onTheaterModeToggle={vi.fn()}
        zap={{ ...fakeZap(), missing: '99' }}
      />
    )

    expect(screen.getByTestId('player-info-rail')).toHaveTextContent('No channel 99')
    expect(shell()).toContainElement(screen.getByTestId('player-info-rail'))
  })

  it('a channel key is one step, however many engines have come and gone', () => {
    const zap = fakeZap()
    const { rerender } = render(
      <DualModeVideoPlayer channel={liveChannel('https://fixture/a')} isTheaterMode={false} onTheaterModeToggle={vi.fn()} zap={zap} />
    )
    rerender(<DualModeVideoPlayer channel={hlsChannel('1', 1)} isTheaterMode={false} onTheaterModeToggle={vi.fn()} zap={zap} />)

    fireEvent.keyDown(window, { key: 'PageDown' })

    expect(zap.step).toHaveBeenCalledTimes(1)
  })

  it('shows the channel being stepped to in the info rail', () => {
    render(
      <DualModeVideoPlayer
        channel={hlsChannel('1', 1)}
        isTheaterMode={false}
        onTheaterModeToggle={vi.fn()}
        zap={fakeZap({ ...hlsChannel('4', 4), name: 'Cartoons' })}
      />
    )

    expect(screen.getByTestId('player-info-rail')).toHaveTextContent('Cartoons')
  })

  describe('with the page\'s zap and TV store', () => {
    const lineup = [1, 2, 3, 4, 5].map((n) => ({
      id: `e${n}`,
      name: `Channel ${n}`,
      number: n,
      streamUrl: `/e${n}`,
      logoUrl: '',
      group: '',
    }))
    const tunes: string[] = []

    function Page() {
      const selected = useTVStore((s) => s.selectedChannel)
      const previousId = useTVStore((s) => s.previousChannelId)
      const selectChannel = useTVStore((s) => s.selectChannel)
      const getChannels = useTVStore((s) => s.getUnifiedChannels)
      const zap = useChannelZap({
        getChannels,
        selected,
        previousId,
        onTune: (channel) => {
          tunes.push(channel.id)
          selectChannel(channel)
        },
      })
      return <DualModeVideoPlayer channel={selected} isTheaterMode={false} onTheaterModeToggle={vi.fn()} zap={zap} />
    }

    let fullscreenElement: Element | null = null
    beforeEach(() => {
      vi.useFakeTimers()
      tunes.length = 0
      useChannelStore.setState({ currentChannel: null, lastChange: null })
      useErsatztvStore.setState({ channels: lineup })
      useTVStore.setState({ selectedChannel: { ...hlsChannel('e5', 5), streamUrl: '/e5' }, previousChannelId: null })
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
    })
    afterEach(() => {
      vi.useRealTimers()
      fullscreenElement = null
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    })

    it('PageDown x3 in fullscreen tunes once, three channels down, and stays in fullscreen', () => {
      render(<Page />)
      const fullscreen = shell()
      act(() => {
        fullscreenElement = fullscreen
        document.dispatchEvent(new Event('fullscreenchange'))
      })

      for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: 'PageDown' })
      expect(screen.getByTestId('player-info-rail')).toHaveTextContent('Channel 2')
      expect(tunes).toEqual([])

      act(() => {
        vi.advanceTimersByTime(700)
      })

      expect(tunes).toEqual(['e2'])
      expect(useTVStore.getState().selectedChannel?.id).toBe('e2')
      expect(shell()).toBe(fullscreen)
      expect(fullscreen.isConnected).toBe(true)
      expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument()
    })

    it('the rocker in fullscreen steps like PageDown: one tune after the presses stop, still in fullscreen', () => {
      // Fullscreen on a screen with room for the rocker (not a phone)
      matchMediaQueries(['(min-width: 768px)'])
      render(<Page />)
      const fullscreen = shell()
      act(() => {
        fullscreenElement = fullscreen
        document.dispatchEvent(new Event('fullscreenchange'))
      })

      for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Channel down' }))
      expect(screen.getByTestId('player-info-rail')).toHaveTextContent('Channel 2')
      expect(tunes).toEqual([])

      act(() => {
        vi.advanceTimersByTime(700)
      })

      expect(tunes).toEqual(['e2'])
      expect(shell()).toBe(fullscreen)
      expect(screen.getByRole('button', { name: 'Channel up' })).toBeInTheDocument()
    })

    describe('swipes on a phone held sideways', () => {
      afterEach(() => useUIStore.setState({ isNHLOverlayVisible: false }))

      const LANDSCAPE = '(pointer: coarse) and (orientation: landscape) and (max-height: 500px)'
      // A swipe on the picture of an 844 x 390 phone, starting mid-height
      const swipe = (dy: number, from: Element = shell()) => {
        shell().getBoundingClientRect = () => new DOMRect(0, 0, 844, 390)
        for (const [type, y] of [['pointerdown', 195], ['pointerup', 195 + dy]] as const) {
          act(() => {
            from.dispatchEvent(
              new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 1, clientX: 400, clientY: y })
            )
          })
        }
      }

      it('two swipes down show the rail at once and tune once, two channels down', () => {
        matchMediaQueries([LANDSCAPE, '(pointer: coarse)'])
        render(<Page />)

        swipe(80)
        swipe(80)
        expect(screen.getByTestId('player-info-rail')).toHaveTextContent('Channel 3')
        expect(tunes).toEqual([])

        act(() => {
          vi.advanceTimersByTime(700)
        })

        expect(tunes).toEqual(['e3'])
        expect(useTVStore.getState().selectedChannel?.id).toBe('e3')
      })

      it('a swipe up goes to the next channel', () => {
        matchMediaQueries([LANDSCAPE, '(pointer: coarse)'])
        useTVStore.setState({ selectedChannel: { ...hlsChannel('e2', 2), streamUrl: '/e2' } })
        render(<Page />)

        swipe(-80)
        act(() => {
          vi.advanceTimersByTime(700)
        })

        expect(tunes).toEqual(['e3'])
      })

      it('a swipe that starts on the NHL ticker changes nothing', () => {
        matchMediaQueries([LANDSCAPE, '(pointer: coarse)'])
        useUIStore.setState({ isNHLOverlayVisible: true })
        render(<Page />)

        const ticker = screen.getByRole('region', { name: 'NHL scores' })
        swipe(80, within(ticker).getByText('No games today'))
        act(() => {
          vi.advanceTimersByTime(700)
        })

        expect(tunes).toEqual([])
      })

      it('the shell takes the touch gestures itself, so the browser does not scroll them away', () => {
        matchMediaQueries([LANDSCAPE, '(pointer: coarse)'])
        render(<Page />)

        expect(shell()).toHaveClass('touch-none')
      })

      it('in portrait a swipe changes nothing and the page keeps its touch gestures', () => {
        matchMediaQueries(['(pointer: coarse)'])
        render(<Page />)

        swipe(80)
        act(() => {
          vi.advanceTimersByTime(700)
        })

        expect(tunes).toEqual([])
        expect(shell()).not.toHaveClass('touch-none')
      })
    })

    it('has no rocker inline below 1024px', () => {
      render(<Page />)

      expect(screen.queryByRole('group', { name: 'Channel' })).not.toBeInTheDocument()
    })

    it('L goes back to the channel before, and L again returns', () => {
      render(<Page />)
      fireEvent.keyDown(window, { key: ']' })
      act(() => {
        vi.advanceTimersByTime(700)
      })
      // 5 wraps round to the live slot, 0
      expect(useTVStore.getState().selectedChannel?.number).toBe(0)

      fireEvent.keyDown(window, { key: 'l' })
      expect(useTVStore.getState().selectedChannel?.id).toBe('e5')

      fireEvent.keyDown(window, { key: 'L' })
      expect(useTVStore.getState().selectedChannel?.number).toBe(0)
      expect(tunes).toEqual(['live-channel-0', 'e5', 'live-channel-0'])
    })

    it("typing 2 tunes channel 2 after 1.5s, and Enter doesn't wait", () => {
      render(<Page />)

      fireEvent.keyDown(window, { key: '2' })
      expect(screen.getByTestId('player-info-rail')).toHaveTextContent('Channel 2')
      act(() => {
        vi.advanceTimersByTime(1499)
      })
      expect(tunes).toEqual([])
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(useTVStore.getState().selectedChannel?.id).toBe('e2')

      fireEvent.keyDown(window, { key: '4' })
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(useTVStore.getState().selectedChannel?.id).toBe('e4')
      expect(tunes).toEqual(['e2', 'e4'])
    })

    it("an unknown number stays on the channel and says 'No channel 99'", () => {
      render(<Page />)

      fireEvent.keyDown(window, { key: '9' })
      fireEvent.keyDown(window, { key: '9' })
      fireEvent.keyDown(window, { key: 'Enter' })

      expect(tunes).toEqual([])
      expect(useTVStore.getState().selectedChannel?.id).toBe('e5')
      expect(screen.getByTestId('player-info-rail')).toHaveTextContent('No channel 99')

      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(screen.getByTestId('player-info-rail')).toHaveTextContent('Channel 5')
    })
  })
})

describe('DualModeVideoPlayer panel keys', () => {
  const sheet = () => screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })

  beforeEach(() => {
    useChatStore.setState({ isOpen: false })
    useUIStore.setState({ isNHLOverlayVisible: false })
  })

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
    ['the empty live slot', liveChannel('')],
  ])('%s: ? opens the shortcut sheet inside the shell, and Escape closes it', (_what, channel) => {
    render(<DualModeVideoPlayer channel={channel} isTheaterMode={false} onTheaterModeToggle={vi.fn()} />)

    fireEvent.keyDown(window, { key: '?', shiftKey: true })

    const dialog = sheet()
    expect(dialog).toBeInTheDocument()
    // The fullscreen element, so the sheet shows in fullscreen
    expect(shell()).toContainElement(dialog)

    fireEvent.keyDown(dialog as HTMLElement, { key: 'Escape' })
    expect(sheet()).not.toBeInTheDocument()
  })

  it('the sheet stays open across a channel change', () => {
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    fireEvent.keyDown(window, { key: '?' })

    switchTo(hlsChannel('1', 1))

    expect(sheet()).toBeInTheDocument()
  })

  it("the sheet lists the remote's keys on a TV: ↑↓ change channel, OK opens the guide", () => {
    chatFeature.enabled = true
    localStorage.setItem('tv-mode', 'true')
    renderPlayer(hlsChannel('1', 1))

    fireEvent.keyDown(window, { key: '?' })

    const dialog = within(sheet()!)
    expect(dialog.getByText('Guide', { selector: 'dt' })).toBeInTheDocument()
    expect(dialog.getByText("Who's here", { selector: 'dt' })).toBeInTheDocument()
    expect(dialog.queryByText('Theater mode')).not.toBeInTheDocument()
    expect(dialog.queryByText('Open or close chat')).not.toBeInTheDocument()
  })

  it('C opens and closes chat', () => {
    chatFeature.enabled = true
    renderPlayer(hlsChannel('1', 1))

    fireEvent.keyDown(window, { key: 'c' })
    expect(useChatStore.getState().isOpen).toBe(true)

    fireEvent.keyDown(window, { key: 'C' })
    expect(useChatStore.getState().isOpen).toBe(false)
  })

  it('C does nothing where chat is turned off', () => {
    renderPlayer(hlsChannel('1', 1))

    fireEvent.keyDown(window, { key: 'c' })

    expect(useChatStore.getState().isOpen).toBe(false)
  })

  it('N shows and hides the NHL scores', () => {
    renderPlayer(liveChannel(''))

    fireEvent.keyDown(window, { key: 'n' })
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(true)

    fireEvent.keyDown(window, { key: 'N' })
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(false)
  })

  it('C and N work with focus on a sidebar channel button just clicked', () => {
    chatFeature.enabled = true
    renderPlayer(hlsChannel('1', 1))
    const sidebarButton = document.body.appendChild(document.createElement('button'))
    sidebarButton.focus()

    fireEvent.keyDown(sidebarButton, { key: 'c' })
    fireEvent.keyDown(sidebarButton, { key: 'n' })

    expect(useChatStore.getState().isOpen).toBe(true)
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(true)
    sidebarButton.remove()
  })

  describe('/', () => {
    let fullscreenElement: Element | null = null
    beforeEach(() => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
    })
    afterEach(() => {
      fullscreenElement = null
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    })

    it('focuses the channel search, and the sheet lists it', () => {
      const onFocusSearch = vi.fn()
      render(<DualModeVideoPlayer channel={liveChannel('')} isTheaterMode={false} onTheaterModeToggle={vi.fn()} onFocusSearch={onFocusSearch} />)

      fireEvent.keyDown(window, { key: '/' })
      expect(onFocusSearch).toHaveBeenCalledTimes(1)

      fireEvent.keyDown(window, { key: '?' })
      expect(within(sheet()!).getByText('Search channels')).toBeInTheDocument()
    })

    it("does nothing in fullscreen, where the page's search is hidden, and the sheet leaves it out", () => {
      const onFocusSearch = vi.fn()
      render(<DualModeVideoPlayer channel={liveChannel('')} isTheaterMode={false} onTheaterModeToggle={vi.fn()} onFocusSearch={onFocusSearch} />)
      const element = shell()
      act(() => {
        fullscreenElement = element
        document.dispatchEvent(new Event('fullscreenchange'))
      })

      fireEvent.keyDown(window, { key: '/' })
      expect(onFocusSearch).not.toHaveBeenCalled()

      fireEvent.keyDown(window, { key: '?' })
      expect(within(sheet()!).queryByText('Search channels')).not.toBeInTheDocument()
    })

    it('is not in the sheet where the page has no search', () => {
      renderPlayer(liveChannel(''))

      fireEvent.keyDown(window, { key: '?' })

      expect(within(sheet()!).queryByText('Search channels')).not.toBeInTheDocument()
    })
  })

  describe('X (Clip that)', () => {
    beforeEach(() => {
      chatFeature.enabled = true
      clipApi.getHighlightFeatures.mockResolvedValue({ enabled: true, ziplineEnabled: true })
      highlight.enabled = true
      useClipStore.setState({ clipping: false })
    })

    it('clips the channel playing, and the sheet lists it', async () => {
      renderPlayer({ ...liveChannel('https://fixture/a'), backendId: '42' })
      await act(async () => {})

      fireEvent.keyDown(window, { key: 'x' })

      expect(clipApi.createHighlightCapture).toHaveBeenCalledExactlyOnceWith('42', expect.any(AbortSignal))
      // This fake capture has no footage, so the run ends there
      await waitFor(() => expect(useClipStore.getState().clipping).toBe(false))

      fireEvent.keyDown(window, { key: '?' })
      expect(within(sheet()!).getByText('Clip that: post the last 20s to chat')).toBeInTheDocument()
    })

    it('captures nothing while the clip buffer fills, like the clip control', async () => {
      highlight.status = { ...readyBuffer, bufferSeconds: 0 }
      renderPlayer({ ...liveChannel('https://fixture/a'), backendId: '42' })
      await act(async () => {})

      fireEvent.keyDown(window, { key: 'x' })
      expect(clipApi.createHighlightCapture).not.toHaveBeenCalled()
      expect(useClipStore.getState().clipping).toBe(false)
    })

    it('captures nothing while the channel is not recording', async () => {
      highlight.status = { ...readyBuffer, recording: false }
      renderPlayer({ ...liveChannel('https://fixture/a'), backendId: '42' })
      await act(async () => {})

      fireEvent.keyDown(window, { key: 'x' })
      expect(clipApi.createHighlightCapture).not.toHaveBeenCalled()
    })

    it('does nothing without Zipline, and the sheet leaves it out', async () => {
      clipApi.getHighlightFeatures.mockResolvedValue({ enabled: true, ziplineEnabled: false })
      renderPlayer(hlsChannel('1', 1))
      await act(async () => {})

      fireEvent.keyDown(window, { key: 'X' })
      expect(clipApi.createHighlightCapture).not.toHaveBeenCalled()

      fireEvent.keyDown(window, { key: '?' })
      expect(within(sheet()!).queryByText(/Clip that/)).not.toBeInTheDocument()
    })

    it('is not a key on a TV, and the sheet leaves it out', async () => {
      localStorage.setItem('tv-mode', 'true')
      renderPlayer(hlsChannel('1', 1))
      await act(async () => {})

      fireEvent.keyDown(window, { key: 'x' })
      expect(clipApi.createHighlightCapture).not.toHaveBeenCalled()

      fireEvent.keyDown(window, { key: '?' })
      expect(within(sheet()!).queryByText(/Clip that/)).not.toBeInTheDocument()
    })
  })

  it('one press is one toggle, whichever engine is playing', () => {
    chatFeature.enabled = true
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    switchTo(hlsChannel('1', 1))

    fireEvent.keyDown(window, { key: 'c' })
    fireEvent.keyDown(window, { key: 'n' })

    expect(useChatStore.getState().isOpen).toBe(true)
    expect(useUIStore.getState().isNHLOverlayVisible).toBe(true)
  })
})

describe('DualModeVideoPlayer casting', () => {
  const startCast = () =>
    act(() => useCastStore.setState({ isLoading: false, isConnected: true, isCasting: true, deviceName: 'Living Room' }))
  const stopCast = () => act(() => useCastStore.setState({ isCasting: false }))
  const castingCard = () => within(shell()).queryByRole('region', { name: 'Casting to Living Room' })
  let pause: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    useCastStore.setState(INITIAL_CAST_STATE)
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })

  afterEach(() => {
    useCastStore.setState(INITIAL_CAST_STATE)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  })

  it.each([
    ['live', liveChannel('https://fixture/a')],
    ['ErsatzTV', hlsChannel('1', 1)],
  ])('%s: the casting card stands in for the picture, inside the shell', (_engine, channel) => {
    renderPlayer(channel)
    expect(castingCard()).not.toBeInTheDocument()

    startCast()
    expect(castingCard()).toBeInTheDocument()

    stopCast()
    expect(castingCard()).not.toBeInTheDocument()
  })

  it('the card covers the picture, not the controls: the control bar and the info rail paint above it', () => {
    render(<DualModeVideoPlayer channel={liveChannel('https://fixture/a')} isTheaterMode={true} onTheaterModeToggle={vi.fn()} />)
    startCast()

    // Same z-10 as the control bar, which comes later in the shell, so it
    // paints over the card; the info rail is z-20
    const card = castingCard()!
    const bar = within(shell()).getByRole('toolbar', { name: 'Video controls' })
    expect(card).toHaveClass('z-10')
    expect(bar).toHaveClass('z-10')
    expect(card.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card).not.toContainElement(bar)
    expect(within(bar).getByRole('button', { name: 'Exit theater mode' })).toBeInTheDocument()
  })

  it('the shell holds the Cast SDK: a channel change, the empty live slot or the reload after a stop never sets it up again', () => {
    castFeature.mockClear()
    const { switchTo } = renderPlayer(liveChannel('https://fixture/a'))
    expect(castFeature).toHaveBeenCalledTimes(1)

    startCast()
    switchTo(liveChannel(''))
    switchTo(liveChannel('https://fixture/b'))
    stopCast()
    switchTo(hlsChannel('1', 1))

    expect(castFeature).toHaveBeenCalledTimes(1)
  })

  it('ErsatzTV: the notices about the local picture give way to the card', () => {
    renderPlayer(hlsChannel('1', 1))
    act(() => lastPlayerProps().onAutoPlayFail?.({ muted: true, error: policyError() }))
    expect(startPlaybackButton()).toBeInTheDocument()

    startCast()

    expect(startPlaybackButton()).not.toBeInTheDocument()
  })

  it('ErsatzTV: Play in the control bar is undone while casting', () => {
    renderPlayer(hlsChannel('1', 1))
    startCast()
    vidstack.player.pause.mockClear()

    act(() => lastPlayerProps().onPlay?.())

    expect(vidstack.player.pause).toHaveBeenCalledTimes(1)
  })

  it('the empty live slot shows the card too', () => {
    renderPlayer(liveChannel(''))
    startCast()

    expect(castingCard()).toBeInTheDocument()
  })

  it('live: casting pauses and mutes the element, the saved volume and mute unchanged', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(liveChannel('https://fixture/a'))
    vi.mocked(localStorage.setItem).mockClear()

    startCast()

    expect(pause).toHaveBeenCalled()
    expect(video().muted).toBe(true)
    expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: false })
    expect(wroteAudioStorage()).toBe(false)
  })

  it('live: the element stays paused and silent while casting', () => {
    renderPlayer(liveChannel('https://fixture/a'))
    startCast()
    pause.mockClear()

    act(() => {
      video().dispatchEvent(new Event('play'))
      video().muted = false
    })

    expect(pause).toHaveBeenCalledTimes(1)
    expect(video().muted).toBe(true)
    expect(useAudioStore.getState().muted).toBe(false)
  })

  it('live: stopping starts a new player at the live edge, at the saved level', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(liveChannel('https://fixture/a'))
    startCast()
    const paused = video()
    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(1)

    stopCast()

    expect(mpegtsHarness.createPlayer).toHaveBeenCalledTimes(2)
    expect(mpegtsHarness.players[0].destroy).toHaveBeenCalled()
    expect(video()).not.toBe(paused)
    expect(video().muted).toBe(false)
    expect(video().volume).toBe(0.3)
  })

  it('ErsatzTV: casting pauses and mutes the player, the saved mute unchanged; stopping resumes it', () => {
    useAudioStore.setState({ volume: 0.3, muted: false })
    renderPlayer(hlsChannel('1', 1))
    vi.mocked(localStorage.setItem).mockClear()

    startCast()
    expect(vidstack.player.pause).toHaveBeenCalledTimes(1)
    expect(lastPlayerProps().muted).toBe(true)
    expect(useAudioStore.getState()).toMatchObject({ volume: 0.3, muted: false })
    expect(wroteAudioStorage()).toBe(false)

    stopCast()
    expect(vidstack.player.play).toHaveBeenCalledTimes(1)
    expect(lastPlayerProps().muted).toBe(false)
    // Resumed, not remounted
    expect(vidstack.mounted).toHaveBeenCalledTimes(1)
  })

  it('ErsatzTV: while casting, Space leaves the picture paused and a channel change does not autoplay', () => {
    const { switchTo } = renderPlayer(hlsChannel('1', 1))
    startCast()

    fireEvent.keyDown(window, { key: ' ' })
    expect(vidstack.remote.togglePaused).not.toHaveBeenCalled()

    switchTo(hlsChannel('2', 2))
    expect(lastPlayerProps()).toMatchObject({ autoPlay: false, muted: true })
  })

  it('a cast failure in fullscreen shows as a banner inside the shell', () => {
    renderPlayer(liveChannel('https://fixture/a'))
    act(() => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: shell() })
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    act(() => useCastStore.getState().reportError('Living Room stopped playing'))

    expect(within(shell()).getByRole('alert')).toHaveTextContent('Living Room stopped playing')
  })
})

describe('DualModeVideoPlayer behind live', () => {
  const jumpButton = () => screen.queryByRole('button', { name: 'Behind live Jump to live' })
  const clickJump = () => {
    const button = jumpButton()
    if (!button) throw new Error('no Jump to live button')
    fireEvent.click(button)
  }

  describe('live channel (mpegts): its own buffer', () => {
    // jsdom buffers nothing and keeps the picture at 0s; these stand in
    let bufferedEnd: number
    let currentTime: number
    let isPaused: boolean

    beforeEach(() => {
      vi.useFakeTimers()
      bufferedEnd = 0
      currentTime = 0
      isPaused = true
      useCastStore.setState(INITIAL_CAST_STATE)
    })
    afterEach(() => {
      vi.useRealTimers()
      useCastStore.setState(INITIAL_CAST_STATE)
    })

    const renderLive = ({ started = true } = {}) => {
      const view = renderPlayer(liveChannel('https://fixture/a'))
      Object.defineProperty(video(), 'buffered', {
        configurable: true,
        get: (): TimeRanges => ({ length: 1, start: () => 0, end: () => bufferedEnd }),
      })
      Object.defineProperty(video(), 'currentTime', {
        configurable: true,
        get: () => currentTime,
        set: (time: number) => {
          currentTime = time
        },
      })
      Object.defineProperty(video(), 'paused', { configurable: true, get: () => isPaused })
      if (started) {
        act(() => {
          video().dispatchEvent(new Event('playing'))
        })
      }
      return view
    }
    // A paused picture while the stream keeps buffering, measured a second later
    const fallBehind = (seconds: number) => {
      currentTime = 100
      bufferedEnd = 100 + seconds
      act(() => {
        vi.advanceTimersByTime(1000)
      })
    }

    it('says it is behind once the picture is more than 10s short of its buffer, and jumps to the edge, playing', () => {
      renderLive()
      fallBehind(10)
      expect(jumpButton()).not.toBeInTheDocument()

      fallBehind(25)
      expect(jumpButton()).toBeInTheDocument()
      const play = vi.mocked(HTMLMediaElement.prototype.play)
      play.mockClear()

      clickJump()

      expect(currentTime).toBe(122)
      expect(play).toHaveBeenCalledTimes(1)
      act(() => {
        video().dispatchEvent(new Event('seeked'))
      })
      expect(jumpButton()).not.toBeInTheDocument()
    })

    it('says nothing before playback has started: the autoplay notice speaks then', () => {
      renderLive({ started: false })

      fallBehind(25)

      expect(jumpButton()).not.toBeInTheDocument()
    })

    it('says nothing under the casting card, which pauses the picture on purpose', () => {
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
      renderLive()
      act(() => useCastStore.setState({ isLoading: false, isConnected: true, isCasting: true, deviceName: 'Living Room' }))

      fallBehind(25)

      expect(jumpButton()).not.toBeInTheDocument()
    })

    it('a channel change leaves nothing behind', () => {
      const { switchTo } = renderLive()
      fallBehind(25)
      expect(jumpButton()).toBeInTheDocument()

      switchTo(hlsChannel('1', 1))

      expect(jumpButton()).not.toBeInTheDocument()
    })
  })

  describe("ErsatzTV channel (Vidstack): hls.js's live position", () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vidstack.provider.setCurrentTime.mockClear()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    // A sliding-window live playlist: Vidstack can't seek it and calls every
    // picture on it at the live edge, however far behind hls.js's position
    const liveAt = (behind: number, paused: boolean) => {
      vidstack.state = {
        ...vidstack.state,
        paused,
        canPlay: true,
        live: true,
        canSeek: false,
        liveEdge: true,
        currentTime: 100,
        liveSyncPosition: 100 + behind,
      }
      act(() => {
        vi.advanceTimersByTime(1000)
      })
    }

    it("says it is behind once more than 10s short of hls.js's live position, and jumps there, playing", () => {
      renderPlayer(hlsChannel('1', 1))
      liveAt(10, true)
      expect(jumpButton()).not.toBeInTheDocument()

      liveAt(45, true)
      clickJump()

      expect(vidstack.provider.setCurrentTime).toHaveBeenCalledExactlyOnceWith(145)
      expect(vidstack.remote.play).toHaveBeenCalledTimes(1)
      expect(vidstack.remote.seekToLiveEdge).not.toHaveBeenCalled()
    })

    it('says nothing without a live position (no hls.js)', () => {
      renderPlayer(hlsChannel('1', 1))
      liveAt(45, false)
      vidstack.state = { ...vidstack.state, liveSyncPosition: null }
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(jumpButton()).not.toBeInTheDocument()
    })
  })
})

describe('DualModeVideoPlayer pausing the shared live channel', () => {
  const HINT = "You'll fall behind the group"
  const fire = (type: string) =>
    act(() => {
      video().dispatchEvent(new Event(type))
    })

  beforeEach(() => {
    useCastStore.setState(INITIAL_CAST_STATE)
  })
  afterEach(() => {
    useCastStore.setState(INITIAL_CAST_STATE)
  })

  it('hints once, on the first pause after playback started', () => {
    renderPlayer(liveChannel('https://fixture/a'))
    fire('playing')
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()

    fire('pause')
    expect(screen.getByText(HINT)).toBeInTheDocument()

    fire('play')
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()

    fire('pause')
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('says nothing about a picture that never started', () => {
    renderPlayer(liveChannel('https://fixture/a'))

    fire('pause')

    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('says nothing about the casting hold, which pauses the picture on purpose', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    renderPlayer(liveChannel('https://fixture/a'))
    fire('playing')

    act(() => useCastStore.setState({ isLoading: false, isConnected: true, isCasting: true, deviceName: 'Living Room' }))
    fire('pause')

    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })
})
