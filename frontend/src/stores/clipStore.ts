import { create } from 'zustand'

/** The capture being edited: which channel it came from, whatever plays now. */
export interface ClipSession {
  channelId: string
  channelName: string
}

interface ClipState {
  /** The open clip editor's session, or null when the editor is closed */
  session: ClipSession | null
  /** Open the editor on a capture of this channel */
  open: (channelId: string, channelName: string) => void
  close: () => void
}

/**
 * The open clip editor, held outside the player so it outlives the engine:
 * a live channel change or a stream retry remounts the engine, and the
 * editor (with its capture and any export) must survive that. Never saved:
 * a capture does not outlive the page.
 */
export const useClipStore = create<ClipState>()((set) => ({
  session: null,
  open: (channelId, channelName) => set({ session: { channelId, channelName } }),
  close: () => set({ session: null }),
}))
