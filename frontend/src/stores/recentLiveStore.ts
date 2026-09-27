import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Channel } from '@/types'

/** How many recent live channels are kept per person. */
export const RECENT_LIVE_LIMIT = 5

interface RecentLiveState {
  /**
   * Channels each person recently put on live TV, most recent first, keyed by
   * username. Kept per browser (server-side persistence is out of scope), and
   * per person so two admins sharing a device keep their own lists.
   */
  byUser: Record<string, Channel[]>
  /** Remember that `username` just put `channel` on live TV. */
  record: (username: string, channel: Channel) => void
}

export const useRecentLiveStore = create<RecentLiveState>()(
  persist(
    (set) => ({
      byUser: {},

      record: (username, channel) =>
        set((state) => {
          const others = (state.byUser[username] ?? []).filter((c) => c.id !== channel.id)
          return {
            byUser: {
              ...state.byUser,
              [username]: [channel, ...others].slice(0, RECENT_LIVE_LIMIT),
            },
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
const NO_RECENTS: Channel[] = []

/** The channels `username` recently put on live TV, most recent first. */
export function useRecentLiveChannels(username: string | null): Channel[] {
  return useRecentLiveStore((s) => (username ? s.byUser[username] : undefined) ?? NO_RECENTS)
}
