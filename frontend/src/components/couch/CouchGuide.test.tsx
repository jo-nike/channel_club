import { act, fireEvent, render, screen, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CouchGuide } from './CouchGuide'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import type { ErsatzTVChannel, ErsatzTVProgramme } from '@/types'

const NOW = new Date('2026-09-27T18:00:00Z').getTime()
const MINUTE = 60_000
const iso = (ms: number) => new Date(ms).toISOString()
// The guide's own time format, in the test run's locale and time zone
const time = (ms: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ms)

// Unified order: slot 0 (live), then ErsatzTV 1, 2 and 3
const ersatz: ErsatzTVChannel[] = [
  { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', logoUrl: '', group: '' },
  { id: 'e2', name: 'Cartoons', number: 2, streamUrl: '/e2', logoUrl: '', group: '' },
  { id: 'e3', name: 'Westerns', number: 3, streamUrl: '/e3', logoUrl: '', group: '' },
]

function programme(channelId: string, title: string, startMs: number, stopMs: number): ErsatzTVProgramme {
  return { id: `${channelId}-${title}`, channelId, title, start: iso(startMs), stop: iso(stopMs) }
}

const programmes: Record<string, ErsatzTVProgramme[]> = {
  // A quarter of the way through, ending in 30 minutes
  e1: [
    programme('e1', 'The War of the Rohirrim', NOW - 10 * MINUTE, NOW + 30 * MINUTE),
    programme('e1', 'The Hobbit', NOW + 30 * MINUTE, NOW + 180 * MINUTE),
  ],
  e2: [
    programme('e2', 'The Simpsons', NOW - 20 * MINUTE, NOW + 10 * MINUTE),
    programme('e2', 'Metalocalypse', NOW + 10 * MINUTE, NOW + 25 * MINUTE),
  ],
}

const channel = (id: string) => useTVStore.getState().getUnifiedChannels().find((c) => c.id === id)!
const row = (name: RegExp | string) => screen.getByRole('option', { name })
const focused = () => document.activeElement as HTMLElement
const press = (key: string, init: { keyCode?: number } = {}) => fireEvent.keyDown(focused(), { key, ...init })

function renderGuide({ canPickLive = true }: { canPickLive?: boolean } = {}) {
  const onClose = vi.fn()
  render(<CouchGuide onClose={onClose} canPickLive={canPickLive} />)
  return { onClose }
}

// The store's own, put back before each test: a spy set on the store's state
// would outlive its test, since the store copies it into each new state
const realSelectChannel = useTVStore.getState().selectChannel
function spyOnSelectChannel() {
  const selectChannel = vi.fn(realSelectChannel)
  useTVStore.setState({ selectChannel })
  return selectChannel
}

// Elements outside the guide, removed after each test
const extras: Element[] = []

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  useErsatztvStore.setState({ channels: ersatz, programmesByChannel: programmes })
  useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'TSN 5', streamUrl: 'https://fixture/a', guideId: 'tsn5' })
  useTVStore.setState({
    selectChannel: realSelectChannel,
    selectedChannel: channel('e2'),
    previousChannelId: null,
    liveEPG: {
      channelId: 'tsn5',
      currentProgram: { title: 'CFL Football', startTime: iso(NOW - 150 * MINUTE), endTime: iso(NOW + 30 * MINUTE) },
      nextProgram: { title: 'NHL Pre-game', startTime: iso(NOW + 30 * MINUTE), endTime: iso(NOW + 60 * MINUTE) },
    },
    liveEPGStatus: 'ok',
  })
})

afterEach(() => {
  vi.useRealTimers()
  extras.splice(0).forEach((element) => element.remove())
})

describe('CouchGuide: the list', () => {
  it('lists every channel in a listbox, opening with focus on the channel playing', () => {
    renderGuide()

    const listbox = screen.getByRole('listbox', { name: 'Channels' })
    const options = within(listbox).getAllByRole('option')
    expect(options.map((option) => option.textContent?.match(/^\d+/)?.[0])).toEqual(['0', '1', '2', '3'])

    const playing = row(/Cartoons/)
    expect(focused()).toBe(playing)
    expect(playing).toHaveAttribute('aria-selected', 'true')
    expect(playing).toHaveAttribute('aria-current', 'true')
    expect(options.filter((option) => option.getAttribute('aria-selected') === 'true')).toEqual([playing])
    // One tab stop, on the focused row
    expect(options.map((option) => option.tabIndex)).toEqual([-1, -1, 0, -1])
  })

  it("opens on channel 0 when nothing is playing", () => {
    useTVStore.setState({ selectedChannel: null })
    renderGuide()

    expect(focused()).toBe(row(/TSN 5/))
  })

  it('shows what is on now, how far in, and what is next with its start time', () => {
    renderGuide()

    const movies = row(/Movies/)
    expect(movies).toHaveTextContent('The War of the Rohirrim')
    expect(movies).toHaveTextContent(`${time(NOW + 30 * MINUTE)} The Hobbit`)
    expect(within(movies).getByTestId('programme-progress')).toHaveStyle({ width: '25%' })
  })

  it("shows the live channel's now and next from its guide, marked live", () => {
    renderGuide()

    const live = row(/TSN 5/)
    expect(live).toHaveTextContent('CFL Football')
    expect(live).toHaveTextContent(`${time(NOW + 30 * MINUTE)} NHL Pre-game`)
    expect(within(live).getByTestId('live-pill')).toBeInTheDocument()
    expect(within(live).getByTestId('programme-progress')).toHaveStyle({ width: `${(150 / 180) * 100}%` })
  })

  it('says why the live channel has no title when its guide is unavailable', () => {
    useTVStore.setState({ liveEPG: null, liveEPGStatus: 'unavailable' })
    renderGuide()

    expect(row(/TSN 5/)).toHaveTextContent('Guide unavailable')
    expect(within(row(/TSN 5/)).queryByTestId('programme-progress')).not.toBeInTheDocument()
  })

  it.each([
    [true, 'Nothing on yet'],
    [false, 'Waiting for someone to put something on'],
  ])('shows the empty live slot as Live (can pick live: %s): %s', (canPickLive, copy) => {
    useChannelStore.getState().setCurrentChannel(null)
    renderGuide({ canPickLive })

    const live = row(/^0/)
    expect(live).toHaveTextContent('Live')
    expect(live).toHaveTextContent(copy)
    expect(within(live).queryByTestId('live-pill')).not.toBeInTheDocument()
  })

  it('moves on to the next programme as the clock ticks', () => {
    renderGuide()
    expect(row(/Cartoons/)).toHaveTextContent('The Simpsons')

    act(() => { vi.advanceTimersByTime(10 * MINUTE) })

    expect(row(/Cartoons/)).toHaveTextContent('Metalocalypse')
    expect(row(/Cartoons/)).not.toHaveTextContent('The Simpsons')
  })
})

describe('CouchGuide: the remote', () => {
  it('moves focus and the selection down and up with the arrows, stopping at the ends', () => {
    renderGuide()

    expect(press('ArrowDown')).toBe(false)
    expect(focused()).toBe(row(/Westerns/))
    expect(row(/Westerns/)).toHaveAttribute('aria-selected', 'true')
    expect(row(/Cartoons/)).toHaveAttribute('aria-selected', 'false')

    press('ArrowDown')
    expect(focused()).toBe(row(/Westerns/))

    press('ArrowUp')
    press('ArrowUp')
    press('ArrowUp')
    press('ArrowUp')
    expect(focused()).toBe(row(/TSN 5/))
    expect(row(/TSN 5/)).toHaveAttribute('aria-selected', 'true')
  })

  it("reads an older TV's arrows, which arrive with no key name", () => {
    renderGuide()

    press('Unidentified', { keyCode: 40 })

    expect(focused()).toBe(row(/Westerns/))
  })

  it('tunes the focused channel on OK and hides the guide', () => {
    const selectChannel = spyOnSelectChannel()
    const { onClose } = renderGuide()

    press('ArrowUp')
    const notPrevented = press('Enter', { keyCode: 13 })

    expect(notPrevented).toBe(false)
    expect(selectChannel).toHaveBeenCalledTimes(1)
    expect(selectChannel).toHaveBeenCalledWith(channel('e1'))
    expect(useTVStore.getState().selectedChannel?.id).toBe('e1')
    expect(onClose).toHaveBeenCalled()
  })

  it("reads a remote's OK with no key name", () => {
    const { onClose } = renderGuide()

    press('ArrowDown')
    press('Unidentified', { keyCode: 13 })

    expect(useTVStore.getState().selectedChannel?.id).toBe('e3')
    expect(onClose).toHaveBeenCalled()
  })

  it('only hides the guide on OK on the channel playing', () => {
    const selectChannel = spyOnSelectChannel()
    const { onClose } = renderGuide()

    press('Enter', { keyCode: 13 })

    expect(selectChannel).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('tunes a row a Magic Remote pointer clicks', () => {
    const { onClose } = renderGuide()

    fireEvent.click(row(/Movies/))

    expect(useTVStore.getState().selectedChannel?.id).toBe('e1')
    expect(onClose).toHaveBeenCalled()
  })

  it.each([
    ['webOS Back', 'Unidentified', 461],
    ['Tizen Return', 'Unidentified', 10009],
    ['GoBack', 'GoBack', 0],
    ['Backspace', 'Backspace', 8],
    ['Escape', 'Escape', 27],
    ['Guide', 'Guide', 0],
    ['Info', 'Info', 0],
  ])('%s hides the guide without tuning, and cancels the browser default', (_label, key, keyCode) => {
    const selectChannel = spyOnSelectChannel()
    const { onClose } = renderGuide()
    const bubble = vi.fn()
    window.addEventListener('keydown', bubble)

    press('ArrowDown')
    const notPrevented = press(key, { keyCode })

    window.removeEventListener('keydown', bubble)
    expect(notPrevented).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(selectChannel).not.toHaveBeenCalled()
    // Only the arrow reached the page
    expect(bubble).toHaveBeenCalledTimes(1)
  })

  it('stays open while focus moves between rows, and hides once focus leaves it', () => {
    const { onClose } = renderGuide()

    press('ArrowDown')
    expect(onClose).not.toHaveBeenCalled()

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    extras.push(outside)
    act(() => outside.focus())

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
