import { useMemo } from 'react'
import { usePresenceStore } from '@/stores/presenceStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore, isOwnMessage, type ChatIdentity } from '@/stores/chatStore'
import { LIVE_CHANNEL_ID } from '@/stores/tvStore'
import type { ChatMessage, PresenceEntry, UnifiedChannel } from '@/types'

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
export function presenceRowId(entry: Pick<PresenceEntry, 'view' | 'channelId'>): string | null {
  if (entry.view === 'live') return LIVE_CHANNEL_ID
  if (entry.view === 'ersatztv' && entry.channelId) return entry.channelId
  return null
}

/**
 * The channel row a person is on, to join them: live TV is row 0; an
 * ErsatzTV channel is the row whose backendId ?? id is theirs. Null when
 * the row isn't in this viewer's list (or live TV has nothing on).
 */
export function findPresenceChannel(
  entry: Pick<PresenceEntry, 'view' | 'channelId'>,
  channels: UnifiedChannel[]
): UnifiedChannel | null {
  if (presenceRowId(entry) === null) return null
  if (entry.view === 'live') {
    const live = channels[0]
    return live?.type === 'live' && live.streamUrl ? live : null
  }
  // Only ErsatzTV rows: their ids and Dispatcharr's are separate number spaces
  return (
    channels.find((channel) => channel.type === 'ersatztv' && (channel.backendId ?? channel.id) === entry.channelId) ??
    null
  )
}

/**
 * The channel row a chat message was sent from (its server stamp), as
 * findPresenceChannel. A stamp is from the moment it was sent, so live TV
 * only counts while it still shows the same Dispatcharr channel.
 */
export function findMessageChannel(message: ChatMessage, channels: UnifiedChannel[]): UnifiedChannel | null {
  const stamp = { view: message.view ?? null, channelId: message.channelId ?? null }
  const channel = findPresenceChannel(stamp, channels)
  if (channel?.type === 'live' && channel.backendId !== stamp.channelId) return null
  return channel
}

/** A verb to follow the names, as it agrees with one person or several. */
export interface PresenceVerb {
  one: string
  many: string
}

/**
 * 'maya', 'maya and dev', or 'maya and 2 others'. With a verb it follows
 * them: 'maya is here', 'maya and dev are here'.
 */
export function presenceNames(people: readonly PresenceEntry[], verb?: PresenceVerb): string {
  const [first, second] = people
  const names =
    people.length === 1
      ? first.displayName
      : people.length === 2
        ? `${first.displayName} and ${second.displayName}`
        : `${first.displayName} and ${people.length - 1} others`
  if (!verb) return names
  return `${names} ${people.length === 1 ? verb.one : verb.many}`
}

/**
 * The people who share no channel while channels are shown: they hide what
 * they watch. Keyed by userId (names can repeat), for dropping their chips.
 */
export function hidingUserIds(entries: PresenceEntry[]): Set<string> {
  const hiding = new Set<string>()
  for (const entry of entries) {
    if (entry.userId && entry.view === null) hiding.add(entry.userId)
  }
  return hiding
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

/** Everyone here but this viewer, in snapshot order (names only or not). */
export function useOthersHere(): PresenceEntry[] {
  const entries = usePresenceStore((s) => s.entries)
  const nickname = useChatStore((s) => s.nickname)
  const me = useChatStore((s) => s.me)
  return useMemo(() => entries.filter((entry) => !isOwnPresence(entry, { nickname, me })), [entries, nickname, me])
}
