import { useSettingsStore } from '@/stores/settingsStore'
import type { ServerFeatures } from '@/types/ws'

/**
 * Chat shows once the server's connection_ack says it is on (CHAT_ENABLED);
 * until then it stays hidden, like the GIF button.
 */
function chatEnabledWith(features: ServerFeatures | null): boolean {
  return features?.chat === true
}

/** Whether chat is on, re-rendering when the server's answer changes. */
export function useChatEnabled(): boolean {
  return chatEnabledWith(useSettingsStore((s) => s.serverFeatures))
}

/** Whether chat is on right now, for handlers that run outside rendering. */
export function isChatEnabled(): boolean {
  return chatEnabledWith(useSettingsStore.getState().serverFeatures)
}
