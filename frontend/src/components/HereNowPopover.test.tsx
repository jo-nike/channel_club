import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@/test/utils'
import { HereNowPopover } from './HereNowPopover'
import { usePresenceStore } from '@/stores/presenceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import type { ErsatzTVChannel, PresenceEntry, UnifiedChannel } from '@/types'

function entry(overrides: Partial<PresenceEntry> & Pick<PresenceEntry, 'displayName'>): PresenceEntry {
  return { userId: null, channelId: null, channelName: null, programme: null, view: null, since: null, ...overrides }
}

// Live TV reports the Dispatcharr id; the live slot carries it as backendId
const maya = entry({ userId: 'u_maya', displayName: 'maya', view: 'live', channelId: '42', channelName: 'TSN 5', programme: 'CFL Football' })
const dev = entry({ userId: 'u_dev', displayName: 'dev', view: 'ersatztv', channelId: '3', channelName: 'Cartoons' })
const sam = entry({ userId: 'u_sam', displayName: 'sam', view: 'ersatztv', channelId: '8', channelName: 'Taskmaster', programme: 'Series 12' })
const me = entry({ userId: 'u_me', displayName: 'jonike', view: 'ersatztv', channelId: '3', channelName: 'Cartoons' })
// Names only while the admin shows channels: this person hides what they watch
const kim = entry({ userId: 'u_kim', displayName: 'kim' })

const ersatz = (id: string, name: string, number: number): ErsatzTVChannel => ({
  id, name, number, streamUrl: `/etv/${id}`, logoUrl: '', group: '',
})
const cartoons: UnifiedChannel = { id: '3', name: 'Cartoons', number: 3, streamUrl: '/etv/3', type: 'ersatztv', group: '' }

/** Everything as a names-only snapshot would carry it (the admin setting off). */
const namesOnly = (person: PresenceEntry) => entry({ userId: person.userId, displayName: person.displayName })

/** A row's lines of text: the name, then what they're on (if shown). */
const lines = (item: HTMLElement) => Array.from(item.querySelectorAll('p')).map((line) => line.textContent)

function openList() {
  fireEvent.click(screen.getByRole('button', { name: /here$/ }))
  return screen.getByRole('region', { name: 'Here now' })
}

beforeEach(() => {
  usePresenceStore.setState({ entries: [dev, me, maya, sam] })
  useSettingsStore.setState({ presenceVisible: true })
  useUIStore.setState({ hideMyActivity: false })
  useChatStore.setState({ nickname: null, me: { username: 'jonike', userId: 'u_me' } })
  useChannelStore.setState({ currentChannel: { id: '42', name: 'TSN 5', streamUrl: '/live/42', guideId: 'tsn5' } })
  useErsatztvStore.setState({ channels: [ersatz('3', 'Cartoons', 3), ersatz('8', 'Taskmaster', 8)] })
  useTVStore.setState({ selectedChannel: cartoons, previousChannelId: null })
})

afterEach(() => {
  cleanup()
  usePresenceStore.setState({ entries: [] })
  useChannelStore.setState({ currentChannel: null })
  useErsatztvStore.setState({ channels: [] })
  useTVStore.setState({ selectedChannel: null })
})

describe('HereNowPopover', () => {
  it('counts the three others here and stacks their avatars, leaving this viewer out', () => {
    render(<HereNowPopover />)
    const trigger = screen.getByRole('button', { name: '3 here' })
    const stack = trigger.querySelector('[data-slot="presence-stack"]')!
    expect(Array.from(stack.children).map((a) => a.textContent)).toEqual(['D', 'M', 'S'])
  })

  it("lists each person with their channel and programme, Live on live TV", () => {
    render(<HereNowPopover />)
    const list = within(openList()).getAllByRole('listitem')
    expect(list.map((item) => lines(item)[0])).toEqual(['dev', 'maya', 'sam'])
    expect(lines(list[1])[1]).toBe('LiveTSN 5 · CFL Football')
    expect(within(list[1]).getByTestId('live-pill')).toBeInTheDocument()
    expect(lines(list[2])[1]).toBe('Taskmaster · Series 12')
    expect(within(list[2]).queryByTestId('live-pill')).toBeNull()
    expect(screen.queryByText('jonike')).toBeNull()
  })

  it('joins a friend on live TV on row 0', () => {
    render(<HereNowPopover />)
    openList()
    fireEvent.click(screen.getByRole('button', { name: 'Join maya' }))
    const selected = useTVStore.getState().selectedChannel
    expect(selected?.id).toBe(LIVE_CHANNEL_ID)
    expect(selected?.backendId).toBe('42')
    // Joined: the list closes
    expect(screen.queryByRole('region', { name: 'Here now' })).toBeNull()
  })

  it('joins a friend on an ErsatzTV channel on its row', () => {
    render(<HereNowPopover />)
    openList()
    fireEvent.click(screen.getByRole('button', { name: 'Join sam' }))
    expect(useTVStore.getState().selectedChannel).toMatchObject({ id: '8', type: 'ersatztv' })
  })

  it('offers no Join for someone already on your channel', () => {
    render(<HereNowPopover />)
    openList()
    expect(screen.queryByRole('button', { name: 'Join dev' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Join maya' })).toBeInTheDocument()
  })

  it('offers no Join for a channel that is not in your list', () => {
    usePresenceStore.setState({ entries: [entry({ ...sam, channelId: '99' })] })
    render(<HereNowPopover />)
    openList()
    expect(screen.getByText(/Taskmaster/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Join/ })).toBeNull()
  })

  it('shows names only, and no Join, while the admin keeps channels private', () => {
    useSettingsStore.setState({ presenceVisible: false })
    usePresenceStore.setState({ entries: [dev, me, maya, sam].map(namesOnly) })
    render(<HereNowPopover />)
    const region = openList()
    expect(within(region).getAllByRole('listitem').map(lines)).toEqual([['dev'], ['maya'], ['sam']])
    expect(within(region).queryByRole('button')).toBeNull()
  })

  it('shows names only while the setting is off, even before a names-only snapshot arrives', () => {
    useSettingsStore.setState({ presenceVisible: false })
    render(<HereNowPopover />)
    const region = openList()
    expect(region).not.toHaveTextContent('TSN 5')
    expect(within(region).queryByRole('button')).toBeNull()
  })

  it('shows names only while this viewer hides what they watch', () => {
    useUIStore.setState({ hideMyActivity: true })
    render(<HereNowPopover />)
    const region = openList()
    expect(region).not.toHaveTextContent('Taskmaster')
    expect(within(region).queryByRole('button')).toBeNull()
  })

  it("lists someone who hides what they watch by name only, with no channel or Join", () => {
    usePresenceStore.setState({ entries: [kim, maya] })
    render(<HereNowPopover />)
    const [kimRow, mayaRow] = within(openList()).getAllByRole('listitem')
    expect(lines(kimRow)).toEqual(['kim'])
    expect(within(kimRow).queryByRole('button')).toBeNull()
    expect(mayaRow).toHaveTextContent('TSN 5')
  })

  it('renders nothing while nobody else is here', () => {
    usePresenceStore.setState({ entries: [me] })
    render(<HereNowPopover />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('goes away when the last other person leaves, and stays closed when someone arrives', () => {
    render(<HereNowPopover />)
    openList()
    act(() => usePresenceStore.getState().setEntries([me]))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Here now' })).toBeNull()

    act(() => usePresenceStore.getState().setEntries([me, sam]))
    expect(screen.getByRole('button', { name: '1 here' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: 'Here now' })).toBeNull()
  })

  it('keeps the count as the name on a phone, where only the avatars show', () => {
    render(<HereNowPopover variant="phone" />)
    const trigger = screen.getByRole('button', { name: '3 here' })
    expect(within(trigger).getByText('3 here')).toHaveClass('sr-only')
    expect(trigger.querySelector('[data-slot="presence-stack"]')!.children).toHaveLength(3)
  })
})
