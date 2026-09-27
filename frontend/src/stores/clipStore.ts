import { create } from 'zustand'

/** The capture being edited: which channel it came from, whatever plays now. */
export interface ClipSession {
  channelId: string
  channelName: string
}

interface ClipState {
  /** The open clip editor's session, or null when the editor is closed */
  session: ClipSession | null
  /**
   * A 'Clip that' is under way: it holds the server's one capture for this
   * user until it posts, is cancelled or moves to the editor, so neither the
   * editor nor another 'Clip that' may capture meanwhile
   */
  clipping: boolean
  /** Open the editor on a capture of this channel */
  open: (channelId: string, channelName: string) => void
  close: () => void
  setClipping: (clipping: boolean) => void
}

/**
 * The open clip editor, held outside the player so it outlives the engine:
 * a live channel change or a stream retry remounts the engine, and the
 * editor (with its capture and any export) must survive that. Never saved:
 * a capture does not outlive the page.
 */
export const useClipStore = create<ClipState>()((set) => ({
  session: null,
  clipping: false,
  open: (channelId, channelName) => set({ session: { channelId, channelName } }),
  close: () => set({ session: null }),
  setClipping: (clipping) => set({ clipping }),
}))
