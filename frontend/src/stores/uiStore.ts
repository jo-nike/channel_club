// Required side-effect import; it must stay the first import. The audio
// store seeds itself once from the `volume` this store used to persist, so
// it has to read ui-storage before this module is evaluated: hydrating an
// old save below migrates it and immediately writes the partialized state
// back, which drops `volume`.
import './audioStore'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Guide height as a share of the content area: half by default, so it shows
// several channels at once, and never so small or large that the guide or
// the video becomes useless
export const EPG_HEIGHT_DEFAULT = 50
export const EPG_HEIGHT_MIN = 30
export const EPG_HEIGHT_MAX = 75
// The default before v2, which nearly everyone still has
const LEGACY_EPG_HEIGHT_DEFAULT = 25

const clampEPGHeight = (value: number) => Math.max(EPG_HEIGHT_MIN, Math.min(EPG_HEIGHT_MAX, value))

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
  // Set when the guide is opened from the keyboard, for it to take focus
  // once it has rendered (ephemeral - not persisted)
  guideFocusRequested: boolean
  setGuideFocusRequested: (value: boolean) => void
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
  // Keep what I'm watching out of what other members see (admins still see it)
  hideMyActivity: boolean
  setHideMyActivity: (value: boolean) => void
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
      guideFocusRequested: false,
      setGuideFocusRequested: (value) => set({ guideFocusRequested: value }),
      epgHeightPercent: EPG_HEIGHT_DEFAULT,
      setEPGHeightPercent: (value) => set({ epgHeightPercent: clampEPGHeight(value) }),
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
      // Shared unless the person hides it (the admin setting decides whether anyone sees it)
      hideMyActivity: false,
      setHideMyActivity: (value) => set({ hideMyActivity: value }),
      // NHL scores overlay (ephemeral - not persisted)
      isNHLOverlayVisible: false,
      setNHLOverlayVisible: (value) => set({ isNHLOverlayVisible: value }),
      toggleNHLOverlay: () => set((s) => ({ isNHLOverlayVisible: !s.isNHLOverlayVisible })),
    }),
    {
      name: 'ui-storage',
      version: 2,
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
        if (fromVersion < 2) {
          // v2: the guide defaults to 50% (was 25%) within 30-75% (was
          // 15-50%). A stored 25 is the untouched old default, so it moves
          // to the new one; a height someone dragged to is kept, clamped.
          const height = state.epgHeightPercent
          if (height === LEGACY_EPG_HEIGHT_DEFAULT) state.epgHeightPercent = EPG_HEIGHT_DEFAULT
          else if (typeof height === 'number') state.epgHeightPercent = clampEPGHeight(height)
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
        hideMyActivity: state.hideMyActivity,
      }),
    }
  )
)
