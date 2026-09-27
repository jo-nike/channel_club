import { act, fireEvent, render, screen } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RefObject } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { TVView } from './TVView'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore } from '@/stores/tvStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import type { ErsatzTVChannel, UnifiedChannel } from '@/types'
import type { ChannelZap } from '@/hooks/useChannelZap'

const tv = vi.hoisted(() => ({ mode: true }))
const socket = vi.hoisted(() => ({ opened: vi.fn(), sendChannelUpdate: vi.fn() }))
const player = vi.hoisted(() => ({ onFocusSearch: undefined as undefined | (() => void) }))
vi.mock('@/hooks/useTVMode', () => ({ useTVMode: () => tv.mode }))
vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn() }))
vi.mock('@/services/ersatztvApi', () => ({ fetchErsatzTVChannels: vi.fn(), fetchErsatzTVCurrentProgramme: vi.fn(), getErsatzTVLogoUrl: vi.fn() }))
vi.mock('@/hooks/useWebSocket', async () => {
  const { useEffect } = await import('react')
  return { useWebSocket: (options: { view: string }) => {
    // Counts sockets opened, not renders
    useEffect(() => { socket.opened(options.view) }, [options.view])
    return { status: 'connected', sendChannelUpdate: socket.sendChannelUpdate, sendChatMessage: vi.fn(), sendSetNickname: vi.fn() }
  } }
})
const auth = vi.hoisted(() => ({ isAdmin: false }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: auth.isAdmin, logout: vi.fn() }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ userChannelSelection: false }) }))
// The real shell's channel keys, so digits and Enter reach the page's zap as they do in the app
vi.mock('@/components/tv/DualModeVideoPlayer', async () => {
  const { useVideoKeyboardShortcuts } = await import('@/hooks/useVideoKeyboardShortcuts')
  return { DualModeVideoPlayer: ({ channel, zap, onFocusSearch }: { channel: UnifiedChannel | null; zap?: ChannelZap; onFocusSearch?: () => void }) => {
    player.onFocusSearch = onFocusSearch
    useVideoKeyboardShortcuts({
      containerRef: { current: null },
      onChannelStep: zap?.step,
      onLastChannel: zap?.tuneLast,
      onDigit: zap?.digit,
      onDigitCommit: zap?.commitDigits,
    })
    return <div data-testid="player">{channel?.streamUrl || 'No live broadcast'}</div>
  } }
})
vi.mock('@/components/tv/TVEPGGrid', () => ({ TVEPGGrid: () => <div data-testid="tv-epg-grid" /> }))
vi.mock('@/components/tv/TVChannelSidebar', () => ({ TVChannelSidebar: () => <div data-testid="tv-channel-sidebar" /> }))
vi.mock('@/components/ChatPanel', () => ({ ChatPanel: () => <div data-testid="chat-panel" /> }))
vi.mock('@/components/ersatztv/ProgrammeDetailsModal', () => ({ ProgrammeDetailsModal: () => null }))
vi.mock('@/components/AccountMenu', () => ({
  AccountMenu: ({ onOpenAdmin, triggerRef }: { onOpenAdmin: () => void; triggerRef?: RefObject<HTMLButtonElement | null> }) => (
    <button ref={triggerRef} type="button" onClick={onOpenAdmin}>Account menu</button>
  ),
}))
// Where the admin panel last returned focus to when its opener has gone
const adminModal = vi.hoisted(() => ({ returnFocusTo: undefined as { current: HTMLElement | null } | undefined }))
vi.mock('@/components/AdminModal', () => ({
  AdminModal: ({ open, returnFocusTo }: { open: boolean; returnFocusTo?: { current: HTMLElement | null } }) => {
    adminModal.returnFocusTo = returnFocusTo
    return open ? <div role="dialog" aria-label="Admin panel" /> : null
  },
}))

// Unified order: slot 0 (live), then ErsatzTV 1 and 2
const ersatz: ErsatzTVChannel[] = [
  { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', logoUrl: '', group: '' },
  { id: 'e2', name: 'Cartoons', number: 2, streamUrl: '/e2', logoUrl: '', group: '' },
]

const selectedId = () => useTVStore.getState().selectedChannel?.id
const isTheater = () => useUIStore.getState().isTheaterMode
const isCouch = () => document.documentElement.classList.contains('couch')
const press = (key: string, init: { keyCode?: number } = {}) => fireEvent.keyDown(document.body, { key, ...init })

function renderTV() {
  return render(<MemoryRouter><TVView /></MemoryRouter>)
}

beforeEach(() => {
  vi.useFakeTimers()
  tv.mode = true
  auth.isAdmin = false
  socket.opened.mockClear()
  socket.sendChannelUpdate.mockClear()
  useChatStore.setState({ isOpen: false })
  useTVStore.setState({ selectedChannel: null, liveEPG: null })
  useErsatztvStore.setState({
    channels: ersatz,
    channelsLoading: false,
    error: null,
    loadChannels: vi.fn().mockResolvedValue(undefined),
    loadAllProgrammes: vi.fn().mockResolvedValue(undefined),
  })
  useUIStore.setState({ lastTVChannelId: 'e1', isTheaterMode: false, isChannelSidebarCollapsed: false, isEPGVisible: true })
  useChannelStore.getState().setCurrentChannel({ id: 'a', name: 'Sports', streamUrl: 'https://fixture/a', guideId: '' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TV browsers: the couch view', () => {
  it('renders the couch view: the player, with no header, guide grid, channel list or chat', () => {
    renderTV()

    expect(screen.getByTestId('player')).toHaveTextContent('/e1')
    expect(screen.getByTestId('player').closest('.couch-view')).not.toBeNull()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tv-epg-grid')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tv-channel-sidebar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('renders the page layout off a TV', () => {
    tv.mode = false
    renderTV()

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByTestId('tv-epg-grid')).toBeInTheDocument()
    expect(screen.getByTestId('player').closest('.couch-view')).toBeNull()
  })

  it('opens one WebSocket and sends presence for the channel playing', () => {
    renderTV()

    expect(socket.opened).toHaveBeenCalledTimes(1)
    expect(socket.opened).toHaveBeenCalledWith('tv')
    expect(socket.sendChannelUpdate).toHaveBeenLastCalledWith('Movies', null, 'ersatztv', 'e1')

    press('ArrowUp')
    act(() => { vi.advanceTimersByTime(700) })

    expect(socket.opened).toHaveBeenCalledTimes(1)
    expect(socket.sendChannelUpdate).toHaveBeenLastCalledWith('Cartoons', null, 'ersatztv', 'e2')
  })

  it('marks html.couch while it is up, and clears it when it goes', () => {
    const { unmount } = renderTV()
    expect(isCouch()).toBe(true)

    unmount()
    expect(isCouch()).toBe(false)
  })

  it('does not mark html.couch off a TV', () => {
    tv.mode = false
    renderTV()

    expect(isCouch()).toBe(false)
  })

  it('leaves theater alone: the couch view fills the screen without it', () => {
    renderTV()

    expect(isTheater()).toBe(false)
  })

  it('zaps from the remote: ArrowUp tunes the next channel 700ms later', () => {
    renderTV()

    press('ArrowUp')
    act(() => { vi.advanceTimersByTime(700) })

    expect(selectedId()).toBe('e2')
    expect(screen.getByTestId('player')).toHaveTextContent('/e2')
  })

  it('does not zap on arrows off a TV, even in theater', () => {
    tv.mode = false
    renderTV()
    act(() => useUIStore.getState().setTheaterMode(true))

    press('ArrowUp')
    act(() => { vi.advanceTimersByTime(700) })

    expect(selectedId()).toBe('e1')
  })

  it('leaves Escape to the couch view: theater and chat are untouched', () => {
    useUIStore.setState({ isTheaterMode: true })
    act(() => useChatStore.setState({ isOpen: true }))
    renderTV()

    press('Escape', { keyCode: 27 })

    expect(isTheater()).toBe(true)
    expect(useChatStore.getState().isOpen).toBe(true)
  })

  it("offers the player no channel search, as a remote has no '/'", () => {
    renderTV()
    expect(player.onFocusSearch).toBeUndefined()
  })

  it('keeps the account menu, the way back to the page layout, and its admin panel', () => {
    auth.isAdmin = true
    renderTV()

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))

    expect(screen.getByRole('dialog', { name: 'Admin panel' })).toBeInTheDocument()
  })

  // A remote can open Admin only from the account menu, whose item unmounts with the menu
  it('has the admin panel return focus to the account menu button', () => {
    auth.isAdmin = true
    renderTV()

    expect(adminModal.returnFocusTo?.current).toBe(screen.getByRole('button', { name: 'Account menu' }))
  })
})
