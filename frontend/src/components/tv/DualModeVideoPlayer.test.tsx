import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, act, waitFor } from '@/test/utils'
import { DualModeVideoPlayer } from './DualModeVideoPlayer'
import { useAudioStore } from '@/stores/audioStore'
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
  volume?: number
  muted?: boolean
  keyDisabled?: boolean
  onError?: () => void
}

const vidstack = vi.hoisted(() => ({
  mediaPlayer: vi.fn<(props: Record<string, unknown>) => void>(),
  mounted: vi.fn(),
  // Vidstack reports a placeholder volume of 1 until can-play
  state: { paused: false, volume: 1, muted: false, fullscreen: false } as Record<string, unknown>,
  remote: {
    togglePaused: vi.fn(),
    changeVolume: vi.fn(),
    toggleMuted: vi.fn(),
    mute: vi.fn(),
    unmute: vi.fn(),
    toggleFullscreen: vi.fn(),
  },
}))

vi.mock('@vidstack/react', async () => {
  const { useEffect } = await import('react')
  return {
    MediaPlayer: ({ children, ...props }: MediaPlayerProps) => {
      vidstack.mediaPlayer(props)
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

beforeEach(() => {
  localStorage.clear()
  useAudioStore.setState({ volume: 1, muted: false })
  vidstack.state = { paused: false, volume: 1, muted: false, fullscreen: false }
  vidstack.mediaPlayer.mockClear()
  vidstack.mounted.mockClear()
  Object.values(vidstack.remote).forEach((fn) => fn.mockClear())
  highlight.enabled = false
  highlight.modal.mockClear()
  volumeSupport.canSet = true
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
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
