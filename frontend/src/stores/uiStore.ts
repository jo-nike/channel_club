import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  isTheaterMode: boolean
  setTheaterMode: (value: boolean) => void
  toggleTheaterMode: () => void
  isSidebarOpen: boolean
  setSidebarOpen: (value: boolean) => void
  toggleSidebar: () => void
  lastRoute: '/'
  setLastRoute: (route: '/') => void
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
  // Live channel change notifications
  notificationsEnabled: boolean
  setNotificationsEnabled: (value: boolean) => void
  toggleNotifications: () => void
  // Volume persistence (shared across all players)
  volume: number
  setVolume: (value: number) => void
  // NHL scores overlay (ephemeral - not persisted)
  isNHLOverlayVisible: boolean
  setNHLOverlayVisible: (value: boolean) => void
  toggleNHLOverlay: () => void
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
      lastRoute: '/',
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
      // Live channel change notifications (disabled by default)
      notificationsEnabled: false,
      setNotificationsEnabled: (value) => set({ notificationsEnabled: value }),
      toggleNotifications: () => set((s) => ({ notificationsEnabled: !s.notificationsEnabled })),
      // Volume persistence (shared across all players)
      volume: 1,
      setVolume: (value) => set({ volume: Math.max(0, Math.min(1, value)) }),
      // NHL scores overlay (ephemeral - not persisted)
      isNHLOverlayVisible: false,
      setNHLOverlayVisible: (value) => set({ isNHLOverlayVisible: value }),
      toggleNHLOverlay: () => set((s) => ({ isNHLOverlayVisible: !s.isNHLOverlayVisible })),
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
        notificationsEnabled: state.notificationsEnabled,
        volume: state.volume,
      }),
    }
  )
)
