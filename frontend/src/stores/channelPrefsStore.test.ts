import { beforeEach, describe, expect, it } from 'vitest'
import { RECENT_CHANNELS_LIMIT, useChannelPrefsStore } from './channelPrefsStore'

const state = () => useChannelPrefsStore.getState()

describe('channelPrefsStore', () => {
  beforeEach(() => {
    useChannelPrefsStore.setState({
      favouriteChannelIds: [],
      recentChannelIds: [],
      filter: { query: '', mode: 'all' },
    })
    localStorage.clear()
  })

  describe('favourites', () => {
    it('stars a channel and unstars it on a second toggle', () => {
      state().toggleFavourite('etv1')
      state().toggleFavourite('etv2')
      expect(state().favouriteChannelIds).toEqual(['etv1', 'etv2'])

      state().toggleFavourite('etv1')
      expect(state().favouriteChannelIds).toEqual(['etv2'])
    })
  })

  describe('recents', () => {
    it('keeps the most recent channel first', () => {
      state().pushRecent('etv1')
      state().pushRecent('etv2')
      state().pushRecent('etv3')

      expect(state().recentChannelIds).toEqual(['etv3', 'etv2', 'etv1'])
    })

    it('moves a channel picked again to the front instead of listing it twice', () => {
      state().pushRecent('etv1')
      state().pushRecent('etv2')
      state().pushRecent('etv1')

      expect(state().recentChannelIds).toEqual(['etv1', 'etv2'])
    })

    it(`keeps only the last ${RECENT_CHANNELS_LIMIT}`, () => {
      for (let n = 1; n <= 10; n++) state().pushRecent(`etv${n}`)

      expect(RECENT_CHANNELS_LIMIT).toBe(8)
      expect(state().recentChannelIds).toEqual(['etv10', 'etv9', 'etv8', 'etv7', 'etv6', 'etv5', 'etv4', 'etv3'])
    })

    it('leaves the list as it is when the most recent channel is picked again', () => {
      state().pushRecent('etv1')
      const before = state().recentChannelIds

      state().pushRecent('etv1')

      expect(state().recentChannelIds).toBe(before)
    })
  })

  describe('filter', () => {
    it('sets the query and the mode independently, and clears both', () => {
      state().setFilterQuery('simpsons')
      state().setFilterMode('favourites')
      expect(state().filter).toEqual({ query: 'simpsons', mode: 'favourites' })

      state().clearFilter()
      expect(state().filter).toEqual({ query: '', mode: 'all' })
    })
  })

  describe('persistence', () => {
    it("saves favourites and recents under 'channel-prefs' version 1, and not the filter", () => {
      state().toggleFavourite('etv4')
      state().pushRecent('etv2')
      state().setFilterQuery('news')

      const saved = JSON.parse(localStorage.getItem('channel-prefs') ?? '{}')
      expect(saved.version).toBe(1)
      expect(saved.state).toEqual({ favouriteChannelIds: ['etv4'], recentChannelIds: ['etv2'] })
    })

    it('stays out of ui-storage', () => {
      state().toggleFavourite('etv4')

      expect(localStorage.getItem('ui-storage') ?? '').not.toContain('favouriteChannelIds')
    })
  })
})
