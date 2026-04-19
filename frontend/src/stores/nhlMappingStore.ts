import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NhlMappingState {
  /** Map of NHL broadcast network code -> Dispatcharr channel id. */
  overrides: Record<string, string>
  setOverride: (network: string, channelId: string) => void
  clearOverride: (network: string) => void
  clearAll: () => void
}

export const useNhlMappingStore = create<NhlMappingState>()(
  persist(
    (set) => ({
      overrides: {},

      setOverride: (network, channelId) =>
        set((state) => ({
          overrides: { ...state.overrides, [network]: channelId },
        })),

      clearOverride: (network) =>
        set((state) => {
          const next = { ...state.overrides }
          delete next[network]
          return { overrides: next }
        }),

      clearAll: () => set({ overrides: {} }),
    }),
    {
      name: 'nhl-mapping-storage',
    },
  ),
)
