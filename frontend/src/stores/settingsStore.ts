import { create } from 'zustand'
import { logger } from '@/lib/logger'
import type { ServerFeatures } from '@/types/ws'

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
  // Which of chat and GIFs the server has on (connection_ack, features_update);
  // null until the first ack, or from a server that doesn't say
  serverFeatures: ServerFeatures | null
  setServerFeatures: (features: ServerFeatures | null) => void
  // Counts the times the server's optional features may have changed: a
  // features_update, or a reconnect that could have missed one. The hooks that
  // fetch a feature's switch (clips, casting, feedback) fetch it again.
  featuresRevision: number
  noteFeaturesChanged: () => void
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
  serverFeatures: null,
  setServerFeatures: (serverFeatures) => {
    logger.debug('Store', 'Server features', serverFeatures)
    set({ serverFeatures })
  },
  featuresRevision: 0,
  noteFeaturesChanged: () => set((state) => ({ featuresRevision: state.featuresRevision + 1 })),
}))
