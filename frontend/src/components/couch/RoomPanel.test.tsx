import { act, fireEvent, render, screen, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOBODY_HERE_MS, RoomPanel } from './RoomPanel'
import { usePresenceStore } from '@/stores/presenceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import type { ErsatzTVChannel, PresenceEntry } from '@/types'

function entry(overrides: Partial<PresenceEntry> & Pick<PresenceEntry, 'displayName'>): PresenceEntry {
  return { userId: null, channelId: null, channelName: null, programme: null, view: null, since: null, ...overrides }
}

// Live TV reports the Dispatcharr id; the live slot carries it as backendId
const maya = entry({ userId: 'u_maya', displayName: 'maya', view: 'live', channelId: '42', channelName: 'TSN 5', programme: 'CFL Football' })
const dev = entry({ userId: 'u_dev', displayName: 'dev', view: 'ersatztv', channelId: '3', channelName: 'Cartoons' })
const sam = entry({ userId: 'u_sam', displayName: 'sam', view: 'ersatztv', channelId: '8', channelName: 'Taskmaster', programme: 'Series 12' })
const me = entry({ userId: 'u_me', displayName: 'jonike', view: 'ersatztv', channelId: '3', channelName: 'Cartoons' })

/** A person as a names-only snapshot carries them (the admin setting off) */
const namesOnly = (person: PresenceEntry) => entry({ userId: person.userId, displayName: person.displayName })

const ersatz = (id: string, name: string, number: number): ErsatzTVChannel => ({
  id, name, number, streamUrl: `/etv/${id}`, logoUrl: '', group: '',
})

const channel = (id: string) => useTVStore.getState().getUnifiedChannels().find((c) => c.id === id)!
const row = (name: RegExp | string) => screen.getByRole('option', { name })
/** A row's lines of text: the name, then what they're on (if shown) */
const lines = (item: HTMLElement) => Array.from(item.querySelectorAll('p')).map((line) => line.textContent)
const focused = () => document.activeElement as HTMLElement
const press = (key: string, init: { keyCode?: number } = {}) => fireEvent.keyDown(focused(), { key, ...init })

function renderPanel() {
  const onClose = vi.fn()
  const view = render(<RoomPanel onClose={onClose} />)
  return { onClose, ...view }
}

// The store's own, put back before each test (a spy on the state would outlive it)
const realSelectChannel = useTVStore.getState().selectChannel
function spyOnSelectChannel() {
  const selectChannel = vi.fn(realSelectChannel)
  useTVStore.setState({ selectChannel })
  return selectChannel
}

// Elements outside the panel, removed after each test
const extras: Element[] = []

beforeEach(() => {
  usePresenceStore.setState({ entries: [dev, me, maya, sam] })
  useSettingsStore.setState({ presenceVisible: true })
  useUIStore.setState({ hideMyActivity: false })
  useChatStore.setState({ nickname: null, me: { username: 'jonike', userId: 'u_me' } })
  useChannelStore.setState({ currentChannel: { id: '42', name: 'TSN 5', streamUrl: '/live/42', guideId: 'tsn5' } })
  useErsatztvStore.setState({ channels: [ersatz('3', 'Cartoons', 3), ersatz('8', 'Taskmaster', 8)] })
  useTVStore.setState({ selectChannel: realSelectChannel, selectedChannel: channel('3'), previousChannelId: null })
})

afterEach(() => {
  vi.useRealTimers()
  extras.splice(0).forEach((element) => element.remove())
  usePresenceStore.setState({ entries: [] })
  useSettingsStore.setState({ presenceVisible: false })
  useChannelStore.setState({ currentChannel: null })
  useErsatztvStore.setState({ channels: [] })
  useTVStore.setState({ selectedChannel: null })
})

describe('RoomPanel: who is here', () => {
  it('lists everyone else here with their channel and programme, leaving this viewer out', () => {
    renderPanel()

    const listbox = screen.getByRole('listbox', { name: 'Here now' })
    const options = within(listbox).getAllByRole('option')
    expect(options.map((option) => lines(option)[0])).toEqual(['dev', 'maya', 'sam'])
    expect(lines(options[0])[1]).toBe('Cartoons')
    expect(lines(options[1])[1]).toBe('LiveTSN 5 · CFL Football')
    expect(within(options[1]).getByTestId('live-pill')).toBeInTheDocument()
    expect(lines(options[2])[1]).toBe('Taskmaster · Series 12')
    expect(within(options[2]).queryByTestId('live-pill')).not.toBeInTheDocument()
    expect(screen.queryByText('jonike')).not.toBeInTheDocument()
  })

  it('offers Join only for friends on another channel', () => {
    renderPanel()

    // dev is on Cartoons, the channel playing here
    expect(row(/^dev/)).not.toHaveTextContent('Join')
    expect(row(/^maya/)).toHaveTextContent(/Join$/)
    expect(row(/^sam/)).toHaveTextContent(/Join$/)
  })

  it('shows names only, with nothing to join, while the admin keeps channels hidden', () => {
    useSettingsStore.setState({ presenceVisible: false })
    usePresenceStore.setState({ entries: [dev, me, maya, sam].map(namesOnly) })
    const selectChannel = spyOnSelectChannel()
    const { onClose } = renderPanel()

    const options = screen.getAllByRole('option')
    expect(options.map(lines)).toEqual([['dev'], ['maya'], ['sam']])
    expect(screen.queryByText('Join')).not.toBeInTheDocument()
    expect(screen.queryByTestId('live-pill')).not.toBeInTheDocument()
    expect(screen.queryByText('OK')).not.toBeInTheDocument()

    press('ArrowDown')
    press('Enter', { keyCode: 13 })
    expect(selectChannel).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows names only to a viewer hiding their own channel, even with channels in the snapshot', () => {
    useUIStore.setState({ hideMyActivity: true })
    renderPanel()

    expect(screen.getAllByRole('option').map(lines)).toEqual([['dev'], ['maya'], ['sam']])
    expect(screen.queryByText('Join')).not.toBeInTheDocument()
  })

  describe('opened while nobody else is here', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('says so briefly, then closes', () => {
      usePresenceStore.setState({ entries: [me] })
      const { onClose } = renderPanel()

      expect(screen.getByRole('status')).toHaveTextContent('Nobody else is here')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

      act(() => vi.advanceTimersByTime(NOBODY_HERE_MS - 1))
      expect(onClose).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("doesn't turn into the list when a friend arrives meanwhile", () => {
      usePresenceStore.setState({ entries: [me] })
      const { onClose } = renderPanel()

      act(() => usePresenceStore.setState({ entries: [me, sam] }))

      expect(screen.getByRole('status')).toHaveTextContent('Nobody else is here')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(NOBODY_HERE_MS))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('closes when the last friend leaves', () => {
    usePresenceStore.setState({ entries: [me, sam] })
    const { onClose } = renderPanel()
    expect(onClose).not.toHaveBeenCalled()

    act(() => usePresenceStore.setState({ entries: [me] }))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('RoomPanel: the remote', () => {
  it('opens with focus on the first friend, and moves with the arrows', () => {
    renderPanel()

    expect(focused()).toBe(row(/^dev/))
    expect(row(/^dev/)).toHaveAttribute('aria-selected', 'true')

    press('ArrowDown')
    expect(focused()).toBe(row(/^maya/))
    expect(row(/^maya/)).toHaveAttribute('aria-selected', 'true')
    expect(row(/^dev/)).toHaveAttribute('aria-selected', 'false')
  })

  it("joins a friend's channel on OK and hides the panel", () => {
    const selectChannel = spyOnSelectChannel()
    const { onClose } = renderPanel()

    press('ArrowDown')
    press('ArrowDown')
    const notPrevented = press('Enter', { keyCode: 13 })

    expect(notPrevented).toBe(false)
    expect(selectChannel).toHaveBeenCalledTimes(1)
    expect(useTVStore.getState().selectedChannel?.id).toBe('8')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("joins a friend on live TV on channel 0, from a remote's OK with no key name", () => {
    const { onClose } = renderPanel()

    press('ArrowDown')
    press('Unidentified', { keyCode: 13 })

    expect(useTVStore.getState().selectedChannel?.id).toBe(LIVE_CHANNEL_ID)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does nothing on OK for a friend already on the channel playing', () => {
    const selectChannel = spyOnSelectChannel()
    const { onClose } = renderPanel()

    press('Enter', { keyCode: 13 })

    expect(selectChannel).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('joins a friend a Magic Remote pointer clicks', () => {
    const { onClose } = renderPanel()

    fireEvent.click(row(/^sam/))

    expect(useTVStore.getState().selectedChannel?.id).toBe('8')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['webOS Back', 'Unidentified', 461],
    ['Tizen Return', 'Unidentified', 10009],
    ['Backspace', 'Backspace', 8],
    ['Escape', 'Escape', 27],
    ['the green key', 'ColorF1Green', 404],
    ['the green key with no key name', 'Unidentified', 404],
  ])('%s hides the panel without joining, and cancels the browser default', (_label, key, keyCode) => {
    const selectChannel = spyOnSelectChannel()
    const { onClose } = renderPanel()
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
})

describe('RoomPanel: focus', () => {
  it('keeps focus in the panel when the friend focused leaves', () => {
    const { onClose } = renderPanel()
    press('ArrowDown')
    expect(focused()).toBe(row(/^maya/))

    act(() => usePresenceStore.setState({ entries: [dev, me, sam] }))

    expect(screen.getByRole('listbox').contains(focused())).toBe(true)
    expect(focused()).toHaveAttribute('aria-selected', 'true')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hides once focus moves somewhere else', () => {
    const { onClose } = renderPanel()

    press('ArrowDown')
    expect(onClose).not.toHaveBeenCalled()

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    extras.push(outside)
    act(() => outside.focus())

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides once focus falls to nothing, such as a click on the picture', () => {
    vi.useFakeTimers()
    const { onClose } = renderPanel()

    act(() => focused().blur())
    expect(onClose).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(0) })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
