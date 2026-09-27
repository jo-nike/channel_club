// Required side-effect import; it must stay the first import. The audio
// store seeds itself once from the `volume` this store used to persist, so
// it has to read ui-storage before this module is evaluated: hydrating an
// old save below migrates it and immediately writes the partialized state
// back, which drops `volume`.
import './audioStore'
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
      // EPG visibility and sizing (guide starts closed; the header toggle opens it)
      isEPGVisible: false,
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
      // Live channel change pop-ups (on by default)
      notificationsEnabled: true,
      setNotificationsEnabled: (value) => set({ notificationsEnabled: value }),
      toggleNotifications: () => set((s) => ({ notificationsEnabled: !s.notificationsEnabled })),
      // NHL scores overlay (ephemeral - not persisted)
      isNHLOverlayVisible: false,
      setNHLOverlayVisible: (value) => set({ isNHLOverlayVisible: value }),
      toggleNHLOverlay: () => set((s) => ({ isNHLOverlayVisible: !s.isNHLOverlayVisible })),
    }),
    {
      name: 'ui-storage',
      version: 1,
      // Chained: one `if (fromVersion < n)` guard per version, in order, so an
      // old save runs every step after it. (Not a fall-through switch:
      // noFallthroughCasesInSwitch rejects that once a second case exists.)
      // Unknown fields (such as the legacy `volume`) pass through migrate,
      // but persist writes the partialized state right after migrating, so
      // they are gone from ui-storage as soon as this store is created. The
      // audio store's volume seed survives only because the import at the
      // top of this file evaluates it first.
      migrate: (persistedState, fromVersion) => {
        const state = { ...(persistedState as Record<string, unknown>) }
        if (fromVersion < 1) {
          // v1: live-change pop-ups default on. An old `false` can't be told
          // apart from the old default, so everyone is switched on once.
          state.notificationsEnabled = true
        }
        // Fields missing from old saves are filled from the defaults on merge
        return state as unknown as UIState
      },
      partialize: (state) => ({
        isSidebarOpen: state.isSidebarOpen,
        lastRoute: state.lastRoute,
        isEPGVisible: state.isEPGVisible,
        epgHeightPercent: state.epgHeightPercent,
        isChannelSidebarCollapsed: state.isChannelSidebarCollapsed,
        lastErsatzTVChannelId: state.lastErsatzTVChannelId,
        lastTVChannelId: state.lastTVChannelId,
        notificationsEnabled: state.notificationsEnabled,
      }),
    }
  )
)
