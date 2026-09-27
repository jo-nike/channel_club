import { create } from 'zustand'
import type { HighlightCapture } from '@/services/api'
import type { ClipBufferState } from '@/lib/clip'

/** The capture being edited: which channel it came from, whatever plays now. */
export interface ClipSession {
  channelId: string
  channelName: string
  /**
   * A capture already taken, which the editor adopts instead of capturing
   * again: Clip that's Edit hands its own over, so the editor shows the same
   * moment (the server keeps one capture per user, and a new one would
   * replace it with later footage)
   */
  capture?: HighlightCapture
}

/** The clip buffer of the channel the player's controls show (see clipBufferStatus) */
export interface ClipBuffer {
  channelId: string
  state: ClipBufferState
  /** The clip control's label for the state, e.g. 'Buffering clip · 5s of 60s' */
  label: string
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
  /**
   * The playing channel's clip buffer, published by the player's controls
   * (which poll it) so the X key follows the same readiness as the clip
   * control. Null while no controls show one.
   */
  buffer: ClipBuffer | null
  /** Open the editor on a capture of this channel, or on the capture given */
  open: (channelId: string, channelName: string, capture?: HighlightCapture) => void
  close: () => void
  setClipping: (clipping: boolean) => void
  setBuffer: (buffer: ClipBuffer | null) => void
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
  buffer: null,
  open: (channelId, channelName, capture) =>
    set({ session: capture ? { channelId, channelName, capture } : { channelId, channelName } }),
  close: () => set({ session: null }),
  setClipping: (clipping) => set({ clipping }),
  setBuffer: (buffer) => set({ buffer }),
}))
