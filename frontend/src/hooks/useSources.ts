import { useSettingsStore } from '@/stores/settingsStore'
import type { ChannelSources, ServerFeatures } from '@/types/ws'

/** Until the server's connection_ack says, both: what the app showed before it knew. */
const UNTIL_KNOWN: ChannelSources = { dispatcharr: true, ersatztv: true }

function sourcesWith(features: ServerFeatures | null): ChannelSources {
  return features?.sources ?? UNTIL_KNOWN
}

/**
 * Which channel sources the server has an address for. A source that isn't
 * set up has no channels, so what it would fill is left out: without
 * Dispatcharr there is no Live (channel 0), without ErsatzTV no channels 1+.
 */
export function useSources(): ChannelSources {
  return useSettingsStore((s) => sourcesWith(s.serverFeatures))
}

/** useSources for code that runs outside rendering. */
export function currentSources(): ChannelSources {
  return sourcesWith(useSettingsStore.getState().serverFeatures)
}

/**
 * Whether the server has said ErsatzTV is set up. Its load failing only
 * counts as an error then: before the server says, it may not be set up at all.
 */
export function useErsatztvKnownOn(): boolean {
  return useSettingsStore((s) => s.serverFeatures?.sources?.ersatztv === true)
}
