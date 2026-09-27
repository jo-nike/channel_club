import { act, fireEvent, render, screen } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TVView } from './TVView'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import type { ErsatzTVChannel, UnifiedChannel } from '@/types'

const tv = vi.hoisted(() => ({ mode: true }))
vi.mock('@/hooks/useTVMode', () => ({ useTVMode: () => tv.mode }))
vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn() }))
vi.mock('@/services/ersatztvApi', () => ({ fetchErsatzTVChannels: vi.fn(), fetchErsatzTVCurrentProgramme: vi.fn(), getErsatzTVLogoUrl: vi.fn() }))
vi.mock('@/hooks/useWebSocket', () => ({ useWebSocket: () => ({ status: 'connected', sendChannelUpdate: vi.fn(), sendChatMessage: vi.fn(), sendSetNickname: vi.fn() }) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, logout: vi.fn() }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ userChannelSelection: false }) }))
vi.mock('@/components/tv/DualModeVideoPlayer', () => ({ DualModeVideoPlayer: ({ channel }: { channel: UnifiedChannel | null }) => (
  <div data-testid="player">{channel?.streamUrl || 'No live broadcast'}</div>
) }))
vi.mock('@/components/tv/TVEPGGrid', () => ({ TVEPGGrid: () => null }))
vi.mock('@/components/tv/TVChannelSidebar', () => ({ TVChannelSidebar: () => null }))
vi.mock('@/components/ChatPanel', () => ({ ChatPanel: () => null }))
vi.mock('@/components/ersatztv/ProgrammeDetailsModal', () => ({ ProgrammeDetailsModal: () => null }))
vi.mock('@/components/UserSettingsMenu', () => ({ UserSettingsMenu: () => null }))
vi.mock('@/components/FeedbackButton', () => ({ FeedbackButton: () => null }))
vi.mock('@/components/AdminModal', () => ({ AdminModal: () => null }))
vi.mock('@/components/NHLScoresOverlay', () => ({ NHLScoresOverlay: () => null }))

// Unified order: slot 0 (live), then ErsatzTV 1 and 2
const ersatz: ErsatzTVChannel[] = [
  { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', logoUrl: '', group: '' },
  { id: 'e2', name: 'Cartoons', number: 2, streamUrl: '/e2', logoUrl: '', group: '' },
]

const selectedId = () => useTVStore.getState().selectedChannel?.id
const isTheater = () => useUIStore.getState().isTheaterMode
const press = (key: string, init: { keyCode?: number } = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, ...init })

function renderTV() {
  render(<MemoryRouter><TVView /></MemoryRouter>)
}

// Elements outside the app (a text field, a focusable button), removed after each test
const extras: Element[] = []
function addToPage<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  document.body.appendChild(element)
  extras.push(element)
  return element
}

beforeEach(() => {
  vi.useFakeTimers()
  tv.mode = true
  useChatStore.setState({ isOpen: false })
  useTVStore.setState({ selectedChannel: null, liveEPG: null })
  useErsatztvStore.setState({
    channels: ersatz,
    channelsLoading: false,
    error: null,
    loadChannels: vi.fn().mockResolvedValue(undefined),
    loadAllProgrammes: vi.fn().mockResolvedValue(undefined),
  })
  useUIStore.setState({ lastTVChannelId: 'e1', isTheaterMode: false, isChannelSidebarCollapsed: false })
  useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'Sports', streamUrl: 'https://fixture/a', guideId: '' })
})

afterEach(() => {
  vi.useRealTimers()
  extras.splice(0).forEach((element) => element.remove())
})

describe('TV browsers: theater and zapping', () => {
  it('starts in theater mode', () => {
    renderTV()

    expect(isTheater()).toBe(true)
    expect(selectedId()).toBe('e1')
  })

  it('does not force theater, or zap, off a TV', () => {
    tv.mode = false
    renderTV()

    expect(isTheater()).toBe(false)
    act(() => useUIStore.getState().setTheaterMode(true))
    press('ArrowUp')
    act(() => { vi.advanceTimersByTime(700) })

    expect(selectedId()).toBe('e1')
  })

  it('tunes to the next channel 700ms after ArrowUp', () => {
    renderTV()

    press('ArrowUp')
    act(() => { vi.advanceTimersByTime(699) })
    expect(selectedId()).toBe('e1')

    act(() => { vi.advanceTimersByTime(1) })
    expect(selectedId()).toBe('e2')
    expect(screen.getByTestId('player')).toHaveTextContent('/e2')
  })

  it('tunes once to where a burst of presses lands, wrapping through slot 0', () => {
    renderTV()
    const tune = vi.spyOn(useTVStore.getState(), 'selectChannel')

    press('ArrowUp') // 2
    press('ArrowUp') // wraps to 0
    press('PageUp', { keyCode: 33 }) // webOS CH+: 1
    press('PageDown', { keyCode: 34 }) // webOS CH-: 0
    act(() => { vi.advanceTimersByTime(700) })

    expect(selectedId()).toBe('live-channel-0')
    expect(tune).toHaveBeenCalledTimes(1)
  })

  it('shows a banner for the channel being zapped to, then hides it 3s after the last change', () => {
    renderTV()
    const banner = screen.getByRole('status')
    // Entering theater shows the playing channel and the hint
    expect(banner).toHaveTextContent('CH 1 · Movies')
    expect(banner).toHaveTextContent('▲▼ change channel · Back for menu')

    act(() => { vi.advanceTimersByTime(2000) })
    press('ArrowUp')
    expect(banner).toHaveTextContent('CH 2 · Cartoons')

    act(() => { vi.advanceTimersByTime(2999) })
    expect(banner).toHaveTextContent('CH 2 · Cartoons')
    act(() => { vi.advanceTimersByTime(1) })
    expect(banner).toBeEmptyDOMElement()
  })

  it('keeps zap keys from the player and page handlers', () => {
    renderTV()
    const bubble = vi.fn()
    window.addEventListener('keydown', bubble)

    const notPrevented = press('ArrowDown')

    window.removeEventListener('keydown', bubble)
    expect(notPrevented).toBe(false)
    expect(bubble).not.toHaveBeenCalled()
  })

  it('ignores zap keys typed into an input', () => {
    renderTV()
    const input = addToPage('input')

    const notPrevented = press('ArrowUp', {}, input)
    act(() => { vi.advanceTimersByTime(700) })

    expect(notPrevented).toBe(true)
    expect(selectedId()).toBe('e1')
  })

  it('leaves arrows alone outside theater', () => {
    renderTV()
    act(() => useUIStore.getState().setTheaterMode(false))

    const notPrevented = press('ArrowUp')
    act(() => { vi.advanceTimersByTime(700) })

    expect(notPrevented).toBe(true)
    expect(selectedId()).toBe('e1')
    expect(screen.queryByText(/change channel/)).not.toBeInTheDocument()
  })
})

describe('TV browsers: Back and OK', () => {
  afterEach(() => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  })

  it.each([
    ['webOS Back', 'Unidentified', 461],
    ['Tizen Return', 'Unidentified', 10009],
    ['GoBack', 'GoBack', 0],
    ['Backspace', 'Backspace', 8],
  ])('%s leaves theater and cancels the browser default', (_label, key, keyCode) => {
    renderTV()

    const notPrevented = press(key, { keyCode })

    expect(notPrevented).toBe(false)
    expect(isTheater()).toBe(false)
  })

  it('Escape still leaves theater', () => {
    renderTV()

    press('Escape', { keyCode: 27 })

    expect(isTheater()).toBe(false)
  })

  it('Back exits fullscreen before leaving theater', () => {
    renderTV()
    const exitFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body })

    press('Unidentified', { keyCode: 461 })

    expect(exitFullscreen).toHaveBeenCalledTimes(1)
    expect(isTheater()).toBe(true)
  })

  it('Backspace in an input stays with the input', () => {
    renderTV()
    const input = addToPage('input')

    const notPrevented = press('Backspace', { keyCode: 8 }, input)

    expect(notPrevented).toBe(true)
    expect(isTheater()).toBe(true)
  })

  it('leaves Back to the browser outside theater', () => {
    renderTV()
    act(() => useUIStore.getState().setTheaterMode(false))

    expect(press('Unidentified', { keyCode: 461 })).toBe(true)
  })

  it('OK with nothing focused returns to theater', () => {
    renderTV()
    press('Unidentified', { keyCode: 461 })
    expect(isTheater()).toBe(false)

    press('Enter', { keyCode: 13 })

    expect(isTheater()).toBe(true)
  })

  it('OK on a focused button presses the button instead', () => {
    renderTV()
    act(() => useUIStore.getState().setTheaterMode(false))
    const button = addToPage('button')
    button.focus()

    press('Enter', { keyCode: 13 }, button)

    expect(isTheater()).toBe(false)
  })

  it('does not handle Back or OK off a TV', () => {
    tv.mode = false
    renderTV()
    act(() => useUIStore.getState().setTheaterMode(true))

    expect(press('Unidentified', { keyCode: 461 })).toBe(true)
    expect(isTheater()).toBe(true)
  })
})
