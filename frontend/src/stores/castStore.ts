import { create } from 'zustand'

/** A cast failure, stamped so the same message twice still counts as new */
export interface CastError {
  message: string
  /** When it happened (Date.now()) */
  at: number
}

export interface CastState {
  /** The server's cast feature and the Cast SDK are still being checked */
  isLoading: boolean
  /** Cast SDK loaded, feature enabled on the server and a device in reach */
  isAvailable: boolean
  /** Connected to a Chromecast device */
  isConnected: boolean
  /** Media currently playing on the Chromecast */
  isCasting: boolean
  /** Connected device name */
  deviceName: string | null
  /** Remote player state (IDLE, BUFFERING, PLAYING, PAUSED) */
  playerState: string | null
  /** The receiver's own volume (0-1): the TV's, never the audio store's */
  receiverVolume: number
  /** The receiver's own mute */
  receiverMuted: boolean
  /** The latest failure; each report is a new object */
  lastError: CastError | null
}

interface CastStore extends CastState {
  /** Record a failure for the button and the player to show */
  reportError: (message: string) => void
}

export const INITIAL_CAST_STATE: CastState = {
  isLoading: true,
  isAvailable: false,
  isConnected: false,
  isCasting: false,
  deviceName: null,
  playerState: null,
  receiverVolume: 1,
  receiverMuted: false,
  lastError: null,
}

/**
 * Chromecast state, one copy for the page. The Cast SDK's context is a
 * process-wide singleton, so its state is too: useChromecast initialises the
 * SDK once and writes here, and every consumer (the cast button, the player)
 * reads the same values. Never saved: a cast session is the SDK's to resume.
 */
export const useCastStore = create<CastStore>()((set) => ({
  ...INITIAL_CAST_STATE,
  reportError: (message) => set({ lastError: { message, at: Date.now() } }),
}))
