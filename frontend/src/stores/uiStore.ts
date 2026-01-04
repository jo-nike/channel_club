import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  isTheaterMode: boolean
  setTheaterMode: (value: boolean) => void
  toggleTheaterMode: () => void
  isSidebarOpen: boolean
  setSidebarOpen: (value: boolean) => void
  toggleSidebar: () => void
  lastRoute: '/' | '/ersatztv' | '/tv'
  setLastRoute: (route: '/' | '/ersatztv' | '/tv') => void
  // EPG visibility and sizing
  isEPGVisible: boolean
  setEPGVisible: (value: boolean) => void
  toggleEPG: () => void
  epgHeightPercent: number
  setEPGHeightPercent: (value: number) => void
  // Channel sidebar collapse
  isChannelSidebarCollapsed: boolean
  setChannelSidebarCollapsed: (value: boolean) => void
  toggleChannelSidebar: () => void
  // Last ErsatzTV channel (deprecated, use lastTVChannelId)
  lastErsatzTVChannelId: string | null
  setLastErsatzTVChannelId: (id: string | null) => void
  // Last TV channel (unified view - can be 'live-channel-0' or ersatztv channel id)
  lastTVChannelId: string | null
  setLastTVChannelId: (id: string | null) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isTheaterMode: false,
      setTheaterMode: (value) => set({ isTheaterMode: value }),
      toggleTheaterMode: () => set((s) => ({ isTheaterMode: !s.isTheaterMode })),
      isSidebarOpen: false,
      setSidebarOpen: (value) => set({ isSidebarOpen: value }),
      toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
      lastRoute: '/tv',
      setLastRoute: (route) => set({ lastRoute: route }),
      // EPG visibility and sizing
      isEPGVisible: true,
      setEPGVisible: (value) => set({ isEPGVisible: value }),
      toggleEPG: () => set((s) => ({ isEPGVisible: !s.isEPGVisible })),
      epgHeightPercent: 25,
      setEPGHeightPercent: (value) => set({ epgHeightPercent: Math.max(15, Math.min(50, value)) }),
      // Channel sidebar collapse
      isChannelSidebarCollapsed: false,
      setChannelSidebarCollapsed: (value) => set({ isChannelSidebarCollapsed: value }),
      toggleChannelSidebar: () => set((s) => ({ isChannelSidebarCollapsed: !s.isChannelSidebarCollapsed })),
      // Last ErsatzTV channel (deprecated)
      lastErsatzTVChannelId: null,
      setLastErsatzTVChannelId: (id) => set({ lastErsatzTVChannelId: id }),
      // Last TV channel (unified view)
      lastTVChannelId: null,
      setLastTVChannelId: (id) => set({ lastTVChannelId: id }),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        isSidebarOpen: state.isSidebarOpen,
        lastRoute: state.lastRoute,
        isEPGVisible: state.isEPGVisible,
        epgHeightPercent: state.epgHeightPercent,
        isChannelSidebarCollapsed: state.isChannelSidebarCollapsed,
        lastErsatzTVChannelId: state.lastErsatzTVChannelId,
        lastTVChannelId: state.lastTVChannelId,
      }),
    }
  )
)
