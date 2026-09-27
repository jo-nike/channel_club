import { useMemo } from 'react'
import { usePresenceStore } from '@/stores/presenceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore, isOwnMessage, type ChatIdentity } from '@/stores/chatStore'
import { LIVE_CHANNEL_ID } from '@/stores/tvStore'
import type { PresenceEntry } from '@/types'

/** Who this viewer is, as the chat knows them (chatStore's nickname and me). */
export interface OwnIdentity {
  nickname: string | null
  me: ChatIdentity | null
}

/**
 * Whether a presence entry is this viewer. The same rule as chat's own
 * messages: the opaque userId where both sides have one, otherwise the
 * name they're shown under.
 */
export function isOwnPresence(entry: PresenceEntry, own: OwnIdentity): boolean {
  return isOwnMessage({ username: entry.displayName, userId: entry.userId ?? undefined }, own)
}

/**
 * The channel row (UnifiedChannel.id) an entry is watching, or null for an
 * entry without a channel (names only). The live view is row 0 whatever
 * Dispatcharr channel is on it: TVView reports the live slot by its
 * backendId, which no row carries as its id. An ErsatzTV channel reports
 * its own id, which is the row's id.
 */
export function presenceRowId(entry: PresenceEntry): string | null {
  if (entry.view === 'live') return LIVE_CHANNEL_ID
  if (entry.view === 'ersatztv' && entry.channelId) return entry.channelId
  return null
}

/**
 * The people on each channel row, keyed by UnifiedChannel.id, in snapshot
 * order. This viewer and entries without a channel are left out.
 */
export function mapPresenceByChannel(entries: PresenceEntry[], own: OwnIdentity): Map<string, PresenceEntry[]> {
  const byChannel = new Map<string, PresenceEntry[]>()
  for (const entry of entries) {
    if (isOwnPresence(entry, own)) continue
    const rowId = presenceRowId(entry)
    if (rowId === null) continue
    const people = byChannel.get(rowId)
    if (people) people.push(entry)
    else byChannel.set(rowId, [entry])
  }
  return byChannel
}

/**
 * Whether this viewer sees which channel everyone is on: the admin has
 * turned it on, and the viewer isn't hiding their own (someone who keeps
 * theirs private doesn't see anyone else's).
 */
export function useSeesPresenceChannels(): boolean {
  const presenceVisible = useSettingsStore((s) => s.presenceVisible)
  const hideMyActivity = useUIStore((s) => s.hideMyActivity)
  return presenceVisible && !hideMyActivity
}

// One empty map, so readers don't re-render while presence stays off
const NOBODY: ReadonlyMap<string, PresenceEntry[]> = new Map()

/**
 * Who else is on each channel row, keyed by UnifiedChannel.id. Empty while
 * channels aren't shown to this viewer (useSeesPresenceChannels).
 */
export function usePresenceByChannel(): ReadonlyMap<string, PresenceEntry[]> {
  const entries = usePresenceStore((s) => s.entries)
  const nickname = useChatStore((s) => s.nickname)
  const me = useChatStore((s) => s.me)
  const seesChannels = useSeesPresenceChannels()
  return useMemo(
    () => (seesChannels ? mapPresenceByChannel(entries, { nickname, me }) : NOBODY),
    [seesChannels, entries, nickname, me]
  )
}
