import { describe, it, expect, beforeEach } from 'vitest'
import { usePresenceStore } from './presenceStore'
import type { PresenceEntry } from '@/types'

const jon: PresenceEntry = {
  userId: 'u_0123456789abcdef',
  displayName: 'Jon',
  channelId: '12',
  channelName: 'TSN 1',
  programme: 'Hockey Night',
  view: 'live',
  since: '2026-09-27T01:00:00+00:00',
}
const mia: PresenceEntry = {
  userId: 'u_fedcba9876543210',
  displayName: 'Mia',
  channelId: null,
  channelName: null,
  programme: null,
  view: null,
  since: null,
}

describe('presenceStore', () => {
  beforeEach(() => {
    usePresenceStore.setState(usePresenceStore.getInitialState())
  })

  it('knows nobody before the first snapshot', () => {
    expect(usePresenceStore.getState().entries).toEqual([])
  })

  it('takes the snapshot as it is, names-only entries included', () => {
    usePresenceStore.getState().setEntries([jon, mia])
    expect(usePresenceStore.getState().entries).toEqual([jon, mia])
  })

  it('replaces the previous snapshot rather than merging into it', () => {
    usePresenceStore.getState().setEntries([jon, mia])
    usePresenceStore.getState().setEntries([mia])
    expect(usePresenceStore.getState().entries).toEqual([mia])
  })

  it('clears everyone', () => {
    usePresenceStore.getState().setEntries([jon])
    usePresenceStore.getState().clear()
    expect(usePresenceStore.getState().entries).toEqual([])
  })
})
