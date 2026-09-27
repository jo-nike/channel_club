import { create } from 'zustand'
import { logger } from '@/lib/logger'

/**
 * Runtime settings the admin controls for everyone.
 *
 * Deliberately not persisted: this is server state pushed over the WebSocket,
 * not a per-browser preference like uiStore or themeStore.
 */
interface SettingsState {
  userChannelSelection: boolean
  setUserChannelSelection: (enabled: boolean) => void
  // Members may see what everyone is watching; off (names only) until an admin turns it on
  presenceVisible: boolean
  setPresenceVisible: (visible: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  userChannelSelection: false,
  setUserChannelSelection: (userChannelSelection) => {
    logger.debug('Store', `User channel selection: ${userChannelSelection}`)
    set({ userChannelSelection })
  },
  presenceVisible: false,
  setPresenceVisible: (presenceVisible) => {
    logger.debug('Store', `Presence visible: ${presenceVisible}`)
    set({ presenceVisible })
  },
}))
