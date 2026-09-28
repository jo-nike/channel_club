import { useSettingsStore } from '@/stores/settingsStore'
import type { ServerFeatures } from '@/types/ws'

/**
 * Chat shows when the build allows it (VITE_CHAT_ENABLED, a kill switch) and
 * the server hasn't said it is off. Before the first connection_ack, or with a
 * server that doesn't say, the build flag alone decides.
 */
function chatEnabledWith(features: ServerFeatures | null): boolean {
  return import.meta.env.VITE_CHAT_ENABLED === 'true' && features?.chat !== false
}

/** Whether chat is on, re-rendering when the server's answer changes. */
export function useChatEnabled(): boolean {
  return chatEnabledWith(useSettingsStore((s) => s.serverFeatures))
}

/** Whether chat is on right now, for handlers that run outside rendering. */
export function isChatEnabled(): boolean {
  return chatEnabledWith(useSettingsStore.getState().serverFeatures)
}
