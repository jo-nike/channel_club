import { create } from 'zustand'
import { logger } from '@/lib/logger'
import type { PresenceEntry } from '@/types'

/**
 * Who is here right now: one entry per person, as the server's snapshot has it.
 *
 * Server state pushed over the WebSocket (connection_ack and presence_update),
 * so it is not persisted. Each snapshot replaces the last one whole. The
 * server leaves the channel fields empty unless the admin lets members see
 * what everyone is watching, and for anyone who hides it.
 */
interface PresenceState {
  entries: PresenceEntry[]
  setEntries: (entries: PresenceEntry[]) => void
  clear: () => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  entries: [],
  setEntries: (entries) => {
    logger.debug('Store', `Presence: ${entries.length} here`)
    set({ entries })
  },
  clear: () => set({ entries: [] }),
}))
