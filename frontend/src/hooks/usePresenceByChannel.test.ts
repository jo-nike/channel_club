import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  isOwnPresence,
  mapPresenceByChannel,
  presenceRowId,
  usePresenceByChannel,
  useSeesPresenceChannels,
} from './usePresenceByChannel'
import { usePresenceStore } from '@/stores/presenceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { LIVE_CHANNEL_ID } from '@/stores/tvStore'
import type { PresenceEntry } from '@/types'

function entry(overrides: Partial<PresenceEntry> & Pick<PresenceEntry, 'displayName'>): PresenceEntry {
  return {
    userId: null,
    channelId: null,
    channelName: null,
    programme: null,
    view: null,
    since: null,
    ...overrides,
  }
}

// Live TV reports the Dispatcharr channel id (the live slot's backendId)
const maya = entry({ userId: 'u_maya', displayName: 'maya', view: 'live', channelId: '42', channelName: 'TSN 5', programme: 'CFL Football' })
const dev = entry({ userId: 'u_dev', displayName: 'dev', view: 'live', channelId: '42', channelName: 'TSN 5' })
const sam = entry({ userId: 'u_sam', displayName: 'sam', view: 'ersatztv', channelId: 'etv-8', channelName: 'Taskmaster' })
// Names only: presence off, or a person who hides what they watch
const kim = entry({ userId: 'u_kim', displayName: 'kim' })
const me = entry({ userId: 'u_me', displayName: 'jonike', view: 'ersatztv', channelId: 'etv-8', channelName: 'Taskmaster' })

const nobody = { nickname: null, me: null }

describe('presenceRowId', () => {
  it('puts everyone on live TV on row 0, whatever Dispatcharr channel is on it', () => {
    expect(presenceRowId(maya)).toBe(LIVE_CHANNEL_ID)
    expect(presenceRowId({ ...maya, channelId: '7' })).toBe(LIVE_CHANNEL_ID)
  })

  it('puts an ErsatzTV viewer on the row with their channel id', () => {
    expect(presenceRowId(sam)).toBe('etv-8')
  })

  it('has no row for an entry without a channel', () => {
    expect(presenceRowId(kim)).toBeNull()
    expect(presenceRowId({ ...sam, channelId: null })).toBeNull()
  })
})

describe('isOwnPresence', () => {
  it('matches on the userId when both sides have one, not the name', () => {
    const own = { nickname: 'maya', me: { username: 'jonike', userId: 'u_me' } }
    expect(isOwnPresence(me, own)).toBe(true)
    expect(isOwnPresence(maya, own)).toBe(false)
  })

  it('falls back to the name without ids', () => {
    const own = { nickname: null, me: { username: 'jonike' } }
    expect(isOwnPresence({ ...me, userId: null }, own)).toBe(true)
    expect(isOwnPresence({ ...maya, userId: null }, own)).toBe(false)
  })
})

describe('mapPresenceByChannel', () => {
  it('groups people by row in snapshot order', () => {
    const byChannel = mapPresenceByChannel([dev, maya, sam], nobody)
    expect(byChannel.get(LIVE_CHANNEL_ID)).toEqual([dev, maya])
    expect(byChannel.get('etv-8')).toEqual([sam])
    expect(byChannel.size).toBe(2)
  })

  it('leaves this viewer out', () => {
    const byChannel = mapPresenceByChannel([me, sam], { nickname: null, me: { username: 'jonike', userId: 'u_me' } })
    expect(byChannel.get('etv-8')).toEqual([sam])
  })

  it('leaves out entries without a channel', () => {
    const byChannel = mapPresenceByChannel([kim, maya], nobody)
    expect([...byChannel.values()].flat()).toEqual([maya])
  })
})

describe('usePresenceByChannel', () => {
  beforeEach(() => {
    usePresenceStore.setState({ entries: [maya, sam, kim, me] })
    useSettingsStore.setState({ presenceVisible: true })
    useUIStore.setState({ hideMyActivity: false })
    useChatStore.setState({ nickname: null, me: { username: 'jonike', userId: 'u_me' } })
  })

  it('maps the others here to their rows, live to row 0, self excluded', () => {
    const { result } = renderHook(() => usePresenceByChannel())
    expect(result.current.get(LIVE_CHANNEL_ID)).toEqual([maya])
    expect(result.current.get('etv-8')).toEqual([sam])
    expect(result.current.size).toBe(2)
  })

  it('is empty while the admin setting is off', () => {
    useSettingsStore.setState({ presenceVisible: false })
    const { result } = renderHook(() => usePresenceByChannel())
    expect(result.current.size).toBe(0)
  })

  it('is empty while this viewer hides what they watch', () => {
    useUIStore.setState({ hideMyActivity: true })
    const { result } = renderHook(() => usePresenceByChannel())
    expect(result.current.size).toBe(0)
  })

  it('follows a new snapshot and keeps the same map until something changes', () => {
    const { result, rerender } = renderHook(() => usePresenceByChannel())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)

    act(() => usePresenceStore.getState().setEntries([dev]))
    expect(result.current.get(LIVE_CHANNEL_ID)).toEqual([dev])
    expect(result.current.has('etv-8')).toBe(false)
  })
})

describe('useSeesPresenceChannels', () => {
  it('is on only with the admin setting on and this viewer sharing', () => {
    useSettingsStore.setState({ presenceVisible: true })
    useUIStore.setState({ hideMyActivity: false })
    const { result, rerender } = renderHook(() => useSeesPresenceChannels())
    expect(result.current).toBe(true)

    act(() => useUIStore.setState({ hideMyActivity: true }))
    rerender()
    expect(result.current).toBe(false)

    act(() => {
      useUIStore.setState({ hideMyActivity: false })
      useSettingsStore.setState({ presenceVisible: false })
    })
    rerender()
    expect(result.current).toBe(false)
  })
})
