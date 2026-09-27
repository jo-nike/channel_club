import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { RECENT_LIVE_LIMIT, useRecentLiveChannelIds, useRecentLiveStore } from './recentLiveStore'

const recents = (username: string) => useRecentLiveStore.getState().byUser[username]

describe('recentLiveStore', () => {
  beforeEach(() => {
    useRecentLiveStore.setState({ byUser: {} })
    localStorage.clear()
  })

  it('keeps the most recent channel first', () => {
    const { record } = useRecentLiveStore.getState()
    record('jon', '1')
    record('jon', '2')
    record('jon', '3')

    expect(recents('jon')).toEqual(['3', '2', '1'])
  })

  it('moves a channel picked again to the front instead of listing it twice', () => {
    const { record } = useRecentLiveStore.getState()
    record('jon', '1')
    record('jon', '2')
    record('jon', '1')

    expect(recents('jon')).toEqual(['1', '2'])
  })

  it(`keeps only the last ${RECENT_LIVE_LIMIT}`, () => {
    const { record } = useRecentLiveStore.getState()
    for (const id of ['1', '2', '3', '4', '5', '6', '7']) record('jon', id)

    expect(RECENT_LIVE_LIMIT).toBe(5)
    expect(recents('jon')).toEqual(['7', '6', '5', '4', '3'])
  })

  it('keeps a separate list per person', () => {
    const { record } = useRecentLiveStore.getState()
    record('jon', '1')
    record('sam', '2')

    expect(recents('jon')).toEqual(['1'])
    expect(recents('sam')).toEqual(['2'])
  })

  it("persists only channel ids under 'recent-live-channels'", () => {
    useRecentLiveStore.getState().record('jon', '1')

    const saved = JSON.parse(localStorage.getItem('recent-live-channels') ?? '{}')
    expect(saved.state.byUser).toEqual({ jon: ['1'] })
  })

  describe('prune', () => {
    it("forgets channels no longer in the catalogue, from everyone's list, keeping the order", () => {
      const { record } = useRecentLiveStore.getState()
      record('jon', '1')
      record('jon', '2')
      record('jon', '3')
      record('sam', '2')

      useRecentLiveStore.getState().prune(new Set(['1', '3', '9']))

      expect(recents('jon')).toEqual(['3', '1'])
      expect(recents('sam')).toEqual([])
    })

    it('leaves the state alone when every channel is still there', () => {
      useRecentLiveStore.getState().record('jon', '1')
      const before = useRecentLiveStore.getState().byUser

      useRecentLiveStore.getState().prune(new Set(['1', '2']))

      expect(useRecentLiveStore.getState().byUser).toBe(before)
    })
  })

  describe('useRecentLiveChannelIds', () => {
    it("returns that person's recents", () => {
      useRecentLiveStore.getState().record('jon', '1')

      const { result } = renderHook(() => useRecentLiveChannelIds('jon'))
      expect(result.current).toEqual(['1'])
    })

    it('returns the same empty list for someone with none, or no username', () => {
      const { result: sam } = renderHook(() => useRecentLiveChannelIds('sam'))
      const { result: nobody } = renderHook(() => useRecentLiveChannelIds(null))

      expect(sam.current).toEqual([])
      expect(nobody.current).toBe(sam.current)
    })
  })
})
