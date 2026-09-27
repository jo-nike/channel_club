import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { RECENT_LIVE_LIMIT, useRecentLiveChannels, useRecentLiveStore } from './recentLiveStore'
import type { Channel } from '@/types'

const channel = (id: string): Channel => ({
  id,
  name: `Channel ${id}`,
  streamUrl: `http://stream${id}.m3u8`,
  guideId: id,
})

const recents = (username: string) => useRecentLiveStore.getState().byUser[username]?.map((c) => c.id)

describe('recentLiveStore', () => {
  beforeEach(() => {
    useRecentLiveStore.setState({ byUser: {} })
    localStorage.clear()
  })

  it('keeps the most recent channel first', () => {
    const { record } = useRecentLiveStore.getState()
    record('jon', channel('1'))
    record('jon', channel('2'))
    record('jon', channel('3'))

    expect(recents('jon')).toEqual(['3', '2', '1'])
  })

  it('moves a channel picked again to the front instead of listing it twice', () => {
    const { record } = useRecentLiveStore.getState()
    record('jon', channel('1'))
    record('jon', channel('2'))
    record('jon', channel('1'))

    expect(recents('jon')).toEqual(['1', '2'])
  })

  it(`keeps only the last ${RECENT_LIVE_LIMIT}`, () => {
    const { record } = useRecentLiveStore.getState()
    for (const id of ['1', '2', '3', '4', '5', '6', '7']) record('jon', channel(id))

    expect(RECENT_LIVE_LIMIT).toBe(5)
    expect(recents('jon')).toEqual(['7', '6', '5', '4', '3'])
  })

  it('keeps a separate list per person', () => {
    const { record } = useRecentLiveStore.getState()
    record('jon', channel('1'))
    record('sam', channel('2'))

    expect(recents('jon')).toEqual(['1'])
    expect(recents('sam')).toEqual(['2'])
  })

  it("persists under 'recent-live-channels'", () => {
    useRecentLiveStore.getState().record('jon', channel('1'))

    const saved = JSON.parse(localStorage.getItem('recent-live-channels') ?? '{}')
    expect(saved.state.byUser.jon.map((c: Channel) => c.id)).toEqual(['1'])
  })

  describe('useRecentLiveChannels', () => {
    it("returns that person's recents", () => {
      useRecentLiveStore.getState().record('jon', channel('1'))

      const { result } = renderHook(() => useRecentLiveChannels('jon'))
      expect(result.current.map((c) => c.id)).toEqual(['1'])
    })

    it('returns the same empty list for someone with none, or no username', () => {
      const { result: sam } = renderHook(() => useRecentLiveChannels('sam'))
      const { result: nobody } = renderHook(() => useRecentLiveChannels(null))

      expect(sam.current).toEqual([])
      expect(nobody.current).toBe(sam.current)
    })
  })
})
