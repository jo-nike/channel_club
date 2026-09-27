import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** How many recent live channels are kept per person. */
export const RECENT_LIVE_LIMIT = 5

interface RecentLiveState {
  /**
   * Ids of the channels each person recently put on live TV, most recent
   * first, keyed by username. Kept per browser (server-side persistence is out
   * of scope), and per person so two admins sharing a device keep their own
   * lists. Only ids are kept: names and stream URLs change, so the chips
   * look each id up in the current channel catalogue.
   */
  byUser: Record<string, string[]>
  /** Remember that `username` just put the channel `channelId` on live TV. */
  record: (username: string, channelId: string) => void
  /** Forget every recent channel that is no longer in the catalogue. */
  prune: (catalogueIds: ReadonlySet<string>) => void
}

export const useRecentLiveStore = create<RecentLiveState>()(
  persist(
    (set) => ({
      byUser: {},

      record: (username, channelId) =>
        set((state) => {
          const others = (state.byUser[username] ?? []).filter((id) => id !== channelId)
          return {
            byUser: {
              ...state.byUser,
              [username]: [channelId, ...others].slice(0, RECENT_LIVE_LIMIT),
            },
          }
        }),

      prune: (catalogueIds) =>
        set((state) => {
          const gone = (id: string) => !catalogueIds.has(id)
          if (!Object.values(state.byUser).some((ids) => ids.some(gone))) return state
          return {
            byUser: Object.fromEntries(
              Object.entries(state.byUser).map(([username, ids]) => [
                username,
                ids.filter((id) => !gone(id)),
              ]),
            ),
          }
        }),
    }),
    {
      name: 'recent-live-channels',
      partialize: (state) => ({ byUser: state.byUser }),
    },
  ),
)

// One shared empty list, so a selector for someone with no recents returns a
// stable value and doesn't re-render on every store change
const NO_RECENTS: string[] = []

/** Ids of the channels `username` recently put on live TV, most recent first. */
export function useRecentLiveChannelIds(username: string | null): string[] {
  return useRecentLiveStore((s) => (username ? s.byUser[username] : undefined) ?? NO_RECENTS)
}
