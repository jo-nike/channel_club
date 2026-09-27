import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** How many recently watched channels are kept. */
export const RECENT_CHANNELS_LIMIT = 8

/** Which channels the sidebar and the guide list: all, the favourites, or the recents. */
export type ChannelFilterMode = 'all' | 'favourites' | 'recent'

export interface ChannelFilter {
  /** What was typed in the search box, as typed. */
  query: string
  mode: ChannelFilterMode
}

const NO_FILTER: ChannelFilter = { query: '', mode: 'all' }

interface ChannelPrefsState {
  /**
   * Channels starred in this browser, in the order they were starred. Kept
   * per browser: the backend's state is in memory by design.
   */
  favouriteChannelIds: string[]
  /** Channels picked in this browser, most recent first, without repeats. */
  recentChannelIds: string[]
  /** Star a channel, or unstar it if it's starred. */
  toggleFavourite: (channelId: string) => void
  /** Remember that a channel was just picked. */
  pushRecent: (channelId: string) => void

  // The list filter, shared by the sidebar and the guide so the same
  // channels show in both (not persisted: a reload starts on every channel)
  filter: ChannelFilter
  setFilterQuery: (query: string) => void
  setFilterMode: (mode: ChannelFilterMode) => void
  clearFilter: () => void

  // Set by the '/' shortcut, for whichever search box is on screen to take
  // focus once it has rendered (the collapsed rail expands first). Not persisted.
  searchFocusRequested: boolean
  requestSearchFocus: () => void
  clearSearchFocusRequest: () => void
}

// Its own persisted store rather than part of ui-storage, so favourites stay
// out of the ui-storage versions and migrations other features change
export const useChannelPrefsStore = create<ChannelPrefsState>()(
  persist(
    (set) => ({
      favouriteChannelIds: [],
      recentChannelIds: [],

      toggleFavourite: (channelId) =>
        set((state) => ({
          favouriteChannelIds: state.favouriteChannelIds.includes(channelId)
            ? state.favouriteChannelIds.filter((id) => id !== channelId)
            : [...state.favouriteChannelIds, channelId],
        })),

      pushRecent: (channelId) =>
        set((state) =>
          // Already the most recent: nothing to write
          state.recentChannelIds[0] === channelId
            ? state
            : {
                recentChannelIds: [
                  channelId,
                  ...state.recentChannelIds.filter((id) => id !== channelId),
                ].slice(0, RECENT_CHANNELS_LIMIT),
              }
        ),

      filter: NO_FILTER,
      setFilterQuery: (query) => set((state) => ({ filter: { ...state.filter, query } })),
      setFilterMode: (mode) => set((state) => ({ filter: { ...state.filter, mode } })),
      clearFilter: () => set({ filter: NO_FILTER }),

      searchFocusRequested: false,
      requestSearchFocus: () => set({ searchFocusRequested: true }),
      clearSearchFocusRequest: () => set({ searchFocusRequested: false }),
    }),
    {
      name: 'channel-prefs',
      version: 1,
      partialize: (state) => ({
        favouriteChannelIds: state.favouriteChannelIds,
        recentChannelIds: state.recentChannelIds,
      }),
    }
  )
)
