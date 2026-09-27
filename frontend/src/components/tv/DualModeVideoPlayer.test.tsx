import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, act } from '@/test/utils'
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

vi.mock('@vidstack/react', () => ({
  MediaPlayer: ({ children, ...props }: MediaPlayerProps) => {
    vidstack.mediaPlayer(props)
    return (
      <div data-media-player="" tabIndex={0}>
        {children}
      </div>
    )
  },
  MediaProvider: () => null,
  useMediaState: (prop: string) => vidstack.state[prop] ?? null,
  useMediaRemote: () => vidstack.remote,
}))

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

const liveChannel = (streamUrl: string): UnifiedChannel => ({
  id: 'live-channel-0',
  name: 'Live',
  number: 0,
  streamUrl,
  type: 'live',
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
  Object.values(vidstack.remote).forEach((fn) => fn.mockClear())
  highlight.enabled = false
  highlight.modal.mockClear()
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
