import { act, fireEvent, render, screen } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CouchView } from './CouchView'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import type { ErsatzTVChannel, UnifiedChannel } from '@/types'
import type { ChannelZap } from '@/hooks/useChannelZap'

const player = vi.hoisted(() => ({
  props: null as null | { isTheaterMode: boolean; onFocusSearch?: () => void; onPickLive?: () => void },
}))
// The real shell's channel keys, so keys the couch leaves alone reach the
// page's zap as they do in the app
vi.mock('@/components/tv/DualModeVideoPlayer', async () => {
  const { useVideoKeyboardShortcuts } = await import('@/hooks/useVideoKeyboardShortcuts')
  return { DualModeVideoPlayer: (props: { channel: UnifiedChannel | null; zap?: ChannelZap; isTheaterMode: boolean; onFocusSearch?: () => void; onPickLive?: () => void }) => {
    player.props = props
    const { zap } = props
    useVideoKeyboardShortcuts({
      containerRef: { current: null },
      onChannelStep: zap?.step,
      onLastChannel: zap?.tuneLast,
      onDigit: zap?.digit,
      onDigitCommit: zap?.commitDigits,
    })
    return <div data-testid="player">{props.channel?.streamUrl || 'No live broadcast'}</div>
  } }
})
vi.mock('@/components/tv/TVHeader', () => ({ TVHeader: () => <header data-testid="tv-header" /> }))
vi.mock('@/components/tv/TVEPGGrid', () => ({ TVEPGGrid: () => <div data-testid="tv-epg-grid" /> }))

// Unified order: slot 0 (live), then ErsatzTV 1, 2 and 12
const ersatz: ErsatzTVChannel[] = [
  { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', logoUrl: '', group: '' },
  { id: 'e2', name: 'Cartoons', number: 2, streamUrl: '/e2', logoUrl: '', group: '' },
  { id: 'e12', name: 'Westerns', number: 12, streamUrl: '/e12', logoUrl: '', group: '' },
]

const selectedId = () => useTVStore.getState().selectedChannel?.id
const channel = (id: string) => useTVStore.getState().getUnifiedChannels().find((c) => c.id === id)!
const press = (key: string, init: { keyCode?: number } = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, ...init })

// Elements outside the view (a text field, a focusable button), removed after each test
const extras: Element[] = []
function addToPage<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  document.body.appendChild(element)
  extras.push(element)
  return element
}

function setFullscreenElement(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element })
}

beforeEach(() => {
  vi.useFakeTimers()
  player.props = null
  useErsatztvStore.setState({ channels: ersatz })
  useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'Sports', streamUrl: 'https://fixture/a', guideId: '' })
  useTVStore.setState({ selectedChannel: channel('e1'), previousChannelId: null })
})

afterEach(() => {
  vi.useRealTimers()
  extras.splice(0).forEach((element) => element.remove())
  setFullscreenElement(null)
})

describe('CouchView: layout', () => {
  it('renders only the player, filling the screen: no header and no guide grid', () => {
    render(<CouchView />)

    expect(screen.getByTestId('player')).toHaveTextContent('/e1')
    expect(screen.queryByTestId('tv-header')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tv-epg-grid')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.getByTestId('player').closest('.couch-view')).toHaveClass('fixed', 'inset-0')
    // The player lays out as in theater, which the couch has no way to leave
    expect(player.props?.isTheaterMode).toBe(true)
  })

  it("offers the player no channel search, as a remote has no '/'", () => {
    render(<CouchView />)

    expect(player.props?.onFocusSearch).toBeUndefined()
  })

  it('passes the live TV switcher to the player for the empty live slot', () => {
    const onPickLive = vi.fn()
    render(<CouchView onPickLive={onPickLive} />)

    expect(player.props?.onPickLive).toBe(onPickLive)
  })
})

describe('CouchView: zapping', () => {
  it('tunes to the next channel 700ms after ArrowUp', () => {
    render(<CouchView />)

    press('ArrowUp')
    act(() => { vi.advanceTimersByTime(699) })
    expect(selectedId()).toBe('e1')

    act(() => { vi.advanceTimersByTime(1) })
    expect(selectedId()).toBe('e2')
    expect(screen.getByTestId('player')).toHaveTextContent('/e2')
  })

  it('tunes once to where a burst of presses lands, wrapping through slot 0', () => {
    render(<CouchView />)
    const tune = vi.spyOn(useTVStore.getState(), 'selectChannel')

    press('ArrowDown') // wraps to 0
    press('ArrowDown') // wraps to 12
    press('PageUp', { keyCode: 33 }) // webOS CH+: 0
    press('ChannelUp') // 1
    press('Unidentified', { keyCode: 34 }) // webOS CH- with no key name: 0
    act(() => { vi.advanceTimersByTime(700) })

    expect(selectedId()).toBe('live-channel-0')
    expect(tune).toHaveBeenCalledTimes(1)
  })

  it('keeps zap keys from the player and page handlers', () => {
    render(<CouchView />)
    const bubble = vi.fn()
    window.addEventListener('keydown', bubble)

    const notPrevented = press('ArrowDown')

    window.removeEventListener('keydown', bubble)
    expect(notPrevented).toBe(false)
    expect(bubble).not.toHaveBeenCalled()
  })

  it('ignores zap keys typed into an input', () => {
    render(<CouchView />)
    const input = addToPage('input')

    const notPrevented = press('ArrowUp', {}, input)
    act(() => { vi.advanceTimersByTime(700) })

    expect(notPrevented).toBe(true)
    expect(selectedId()).toBe('e1')
  })

  it('shows a banner for the channel being zapped to, then hides it 3s after the last change', () => {
    render(<CouchView />)
    const banner = screen.getByRole('status')
    // Opening the view shows the playing channel and the hint
    expect(banner).toHaveTextContent('CH 1 · Movies')
    expect(banner).toHaveTextContent('▲▼ change channel · 0-9 channel number')

    act(() => { vi.advanceTimersByTime(2000) })
    press('ArrowUp')
    expect(banner).toHaveTextContent('CH 2 · Cartoons')

    act(() => { vi.advanceTimersByTime(2999) })
    expect(banner).toHaveTextContent('CH 2 · Cartoons')
    act(() => { vi.advanceTimersByTime(1) })
    expect(banner).toBeEmptyDOMElement()
  })

  it('names who changed the live channel in the banner, on channel 0', () => {
    useTVStore.setState({ selectedChannel: channel('live-channel-0') })
    render(<CouchView />)

    act(() => {
      useChannelStore.getState().setCurrentChannel({ id: 'tsn5', name: 'TSN 5', streamUrl: 'https://fixture/tsn5' })
      useChannelStore.getState().setLastChange({ by: 'jon', at: Date.now(), channelName: 'TSN 5' })
    })

    expect(screen.getByRole('status')).toHaveTextContent('jon put on TSN 5')
  })

  it('announces no live change on other channels, which get the toast', () => {
    render(<CouchView />)

    act(() => {
      useChannelStore.getState().setCurrentChannel({ id: 'tsn5', name: 'TSN 5', streamUrl: 'https://fixture/tsn5' })
      useChannelStore.getState().setLastChange({ by: 'jon', at: Date.now(), channelName: 'TSN 5' })
    })

    expect(screen.queryByText('jon put on TSN 5')).not.toBeInTheDocument()
  })
})

describe('CouchView: Back', () => {
  it.each([
    ['webOS Back', 'Unidentified', 461],
    ['Tizen Return', 'Unidentified', 10009],
    ['GoBack', 'GoBack', 0],
    ['Backspace', 'Backspace', 8],
  ])('%s leaves fullscreen and cancels the browser default', (_label, key, keyCode) => {
    const exitFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    setFullscreenElement(document.documentElement)
    render(<CouchView />)

    const notPrevented = press(key, { keyCode })

    expect(notPrevented).toBe(false)
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  })

  it('leaves Back to the browser when nothing is fullscreen', () => {
    render(<CouchView />)

    expect(press('Unidentified', { keyCode: 461 })).toBe(true)
  })

  it('leaves Backspace in an input to the input', () => {
    const exitFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    setFullscreenElement(document.documentElement)
    render(<CouchView />)
    const input = addToPage('input')

    expect(press('Backspace', { keyCode: 8 }, input)).toBe(true)
    expect(exitFullscreen).not.toHaveBeenCalled()
  })
})

describe('couch styles', () => {
  const css = readFileSync('src/index.css', 'utf8')

  it('hides tooltips under html.couch', () => {
    expect(css).toMatch(/\.couch \[data-slot="tooltip-content"\] \{\s*display: none;\s*\}/)
  })
})
