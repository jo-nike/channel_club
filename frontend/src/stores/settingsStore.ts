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
}

export const useSettingsStore = create<SettingsState>((set) => ({
  userChannelSelection: false,
  setUserChannelSelection: (userChannelSelection) => {
    logger.debug('Store', `User channel selection: ${userChannelSelection}`)
    set({ userChannelSelection })
  },
}))
