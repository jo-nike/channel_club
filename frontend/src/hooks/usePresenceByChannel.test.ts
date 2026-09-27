import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  findMessageChannel,
  findPresenceChannel,
  hidingUserIds,
  isOwnPresence,
  mapPresenceByChannel,
  presenceNames,
  presenceRowId,
  useOthersHere,
  usePresenceByChannel,
  useSeesPresenceChannels,
} from './usePresenceByChannel'
import { usePresenceStore } from '@/stores/presenceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { LIVE_CHANNEL_ID, buildUnifiedChannels } from '@/stores/tvStore'
import type { ChatMessage, PresenceEntry } from '@/types'

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

describe('findPresenceChannel', () => {
  const tsn5 = { id: '42', name: 'TSN 5', streamUrl: 'http://stream/5', guideId: 'g5' }
  const channels = buildUnifiedChannels(tsn5, [
    { id: 'etv-8', name: 'Taskmaster', streamUrl: 'http://etv/8', logoUrl: '', number: 8, group: 'TV' },
  ])

  it('finds the live slot for someone on live TV', () => {
    expect(findPresenceChannel(maya, channels)?.id).toBe(LIVE_CHANNEL_ID)
  })

  it('has no live slot to join while live TV is off', () => {
    expect(findPresenceChannel(maya, buildUnifiedChannels(null, []))).toBeNull()
  })

  it('finds an ErsatzTV row by its id, never a live id', () => {
    expect(findPresenceChannel(sam, channels)?.number).toBe(8)
    expect(findPresenceChannel({ view: 'ersatztv', channelId: '42' }, channels)).toBeNull()
  })

  it('finds nothing for an entry without a channel', () => {
    expect(findPresenceChannel(kim, channels)).toBeNull()
  })
})

describe('findMessageChannel', () => {
  const tsn5 = { id: '42', name: 'TSN 5', streamUrl: 'http://stream/5', guideId: 'g5' }
  const channels = buildUnifiedChannels(tsn5, [
    { id: 'etv-8', name: 'Taskmaster', streamUrl: 'http://etv/8', logoUrl: '', number: 8, group: 'TV' },
  ])
  const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
    messageId: 'm1', username: 'maya', content: 'hi', timestamp: '2026-09-27T12:00:00Z', ...overrides,
  })

  it('finds the row a message was sent from', () => {
    expect(findMessageChannel(message({ view: 'ersatztv', channelId: 'etv-8' }), channels)?.id).toBe('etv-8')
    expect(findMessageChannel(message({ view: 'live', channelId: '42' }), channels)?.id).toBe(LIVE_CHANNEL_ID)
  })

  it('skips live TV once it has moved on to another channel', () => {
    expect(findMessageChannel(message({ view: 'live', channelId: '7' }), channels)).toBeNull()
  })

  it('finds nothing for an unstamped message', () => {
    expect(findMessageChannel(message({}), channels)).toBeNull()
  })
})

describe('presenceNames', () => {
  it('names one or two people, and counts the rest after the first', () => {
    expect(presenceNames([maya])).toBe('maya')
    expect(presenceNames([maya, dev])).toBe('maya and dev')
    expect(presenceNames([maya, dev, sam])).toBe('maya and 2 others')
  })

  it('adds the verb that agrees with one person or several', () => {
    const here = { one: 'is here', many: 'are here' }
    expect(presenceNames([maya], here)).toBe('maya is here')
    expect(presenceNames([maya, dev], here)).toBe('maya and dev are here')
    expect(presenceNames([maya, dev, sam], here)).toBe('maya and 2 others are here')
  })
})

describe('hidingUserIds', () => {
  it('lists the people who share no channel', () => {
    expect(hidingUserIds([maya, sam, kim, entry({ displayName: 'anon' })])).toEqual(new Set(['u_kim']))
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

describe('useOthersHere', () => {
  beforeEach(() => {
    usePresenceStore.setState({ entries: [maya, me, kim] })
    useChatStore.setState({ nickname: null, me: { username: 'jonike', userId: 'u_me' } })
  })

  it('lists everyone but this viewer in snapshot order, with or without a channel', () => {
    const { result } = renderHook(() => useOthersHere())
    expect(result.current).toEqual([maya, kim])
  })

  it('shows names whatever the presence settings', () => {
    useSettingsStore.setState({ presenceVisible: false })
    useUIStore.setState({ hideMyActivity: true })
    const { result } = renderHook(() => useOthersHere())
    expect(result.current).toEqual([maya, kim])
  })

  it('follows a new snapshot and keeps the same list until something changes', () => {
    const { result, rerender } = renderHook(() => useOthersHere())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)

    act(() => usePresenceStore.getState().setEntries([me, sam]))
    expect(result.current).toEqual([sam])
  })
})
