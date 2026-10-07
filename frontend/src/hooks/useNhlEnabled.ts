import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import type { ServerFeatures } from '@/types/ws'

/**
 * NHL scores show once the server's connection_ack says they are on
 * (NHL_ENABLED, or the Extras setting); until then they stay hidden, like chat.
 */
function nhlEnabledWith(features: ServerFeatures | null): boolean {
  return features?.nhl === true
}

/** Whether NHL scores are on, re-rendering when the server's answer changes. */
export function useNhlEnabled(): boolean {
  return nhlEnabledWith(useSettingsStore((s) => s.serverFeatures))
}

/** Whether NHL scores are on right now, for handlers that run outside rendering. */
export function isNhlEnabled(): boolean {
  return nhlEnabledWith(useSettingsStore.getState().serverFeatures)
}

/**
 * Whether the NHL scores overlay is showing: opened, and NHL scores still on.
 * Switching them off on the server closes it everywhere that lays out around it.
 */
export function useNhlOverlayVisible(): boolean {
  const opened = useUIStore((s) => s.isNHLOverlayVisible)
  return useNhlEnabled() && opened
}
