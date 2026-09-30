import type { Draft } from '@/components/server-settings/model/configDraft'
import { draftFrom, storableDraft } from '@/components/server-settings/model/draftStorage'
import { readStored, removeStored, writeStored } from '@/lib/storage'
import { hasPendingPlexPin } from '@/services/plexAuth'

/*
 * The Server tab across Plex's redirect sign-in (iPhones, iPads and installed
 * apps), which leaves the page and comes back to the app's home: the unsaved
 * draft (never a secret) and whether Re-link Plex was open, so the Admin panel
 * opens on the tab as it was and the sign-in finishes there. This tab only.
 */

const STASH_KEY = 'channel-club:server-tab-stash'
const session = () => sessionStorage

export interface ServerTabStash {
  draft: Draft
  relinking: boolean
}

export function stashServerTab(stash: ServerTabStash): void {
  writeStored(session, STASH_KEY, { draft: storableDraft(stash.draft), relinking: stash.relinking })
}

/** The stash, while a Plex sign-in waits to be finished: the page is back from Plex. Reading leaves it. */
export function serverTabReturn(): ServerTabStash | null {
  if (!hasPendingPlexPin()) return null
  const value = readStored(session, STASH_KEY)
  if (value === null || typeof value !== 'object') return null
  const { draft, relinking } = value as Record<string, unknown>
  const restored = draftFrom(draft)
  return restored && typeof relinking === 'boolean' ? { draft: restored, relinking } : null
}

export function clearServerTabStash(): void {
  removeStored(session, STASH_KEY)
}
