import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  createCastSession,
  stopCastSession,
  getCastHlsUrl,
  getCastBaseUrl,
} from '@/services/api'
import { logger } from '@/lib/logger'
import { useCastStore, type CastState } from '@/stores/castStore'

/**
 * Chromecast state, as the cast store holds it
 */
export type ChromecastState = CastState

/** What to cast once a device picked in the picker connects */
interface CastParams {
  channelId: string
  streamType: 'hls' | 'mpegts'
  streamUrl?: string
  title?: string
  /** Cast of the Live slot: the server moves it with Live and stops it with Live */
  followsLive?: boolean
}

/**
 * Return type for the useChromecast hook
 */
export interface UseChromecastReturn extends ChromecastState {
  /** Start casting a stream to the connected Chromecast */
  startCasting: (
    channelId: string,
    streamType: 'hls' | 'mpegts',
    streamUrl?: string,
    title?: string,
    followsLive?: boolean
  ) => Promise<void>
  /** Stop the current cast session */
  stopCasting: () => Promise<void>
  /** Show the Cast device picker dialog. If params provided, auto-casts on connect. */
  requestSession: (params?: CastParams) => void
  /** Cast a public test stream for debugging (call from browser console) */
  castTestStream: () => Promise<void>
}

// Default Media Receiver app ID (Google's default receiver that supports HLS)
const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845'

// Backend transcoding session for the active cast, kept at module scope so any
// mounted hook instance can stop it. The Cast SDK context is a process-wide
// singleton, so at most one cast session exists across all instances, but the
// instance that created the backend session may already have unmounted (players
// remount on every channel switch / retry) by the time the cast session ends.
let currentSessionId: string | null = null
const ownedSessions = new Set<string>()
let castGeneration = 0
let castStopped = true
let mediaLoadQueue: Promise<unknown> = Promise.resolve()

async function releaseSession(id: string | null) {
  if (!id || !ownedSessions.delete(id)) return
  if (currentSessionId === id) currentSessionId = null
  await stopCastSession(id).catch(() => {})
}

// The SDK is initialised once for every mounted consumer: the first one to
// mount starts it, the last one to unmount detaches its listeners. Each start
// gets a new token, so an initialisation still waiting on the SDK script gives
// up once its consumers have gone.
let consumers = 0
let initToken = 0
let listeningContext: cast.framework.CastContext | null = null
let remotePlayer: cast.framework.RemotePlayer | null = null
let remoteController: cast.framework.RemotePlayerController | null = null
// The cast operation in flight, cancelled if every consumer unmounts first
let pendingOperation: number | null = null
// Pending cast params for auto-casting after device selection
let pendingCast: CastParams | null = null

const setCastState = (patch: Partial<CastState>) => useCastStore.setState(patch)
const reportError = (message: string) => useCastStore.getState().reportError(message)

/** Start using the Cast SDK; returns the release. */
function acquireCast(): () => void {
  consumers += 1
  if (consumers === 1) initializeCast(++initToken)
  return () => {
    consumers -= 1
    if (consumers === 0) teardownCast()
  }
}

function teardownCast() {
  initToken += 1
  pendingCast = null
  if (pendingOperation === castGeneration) {
    castGeneration += 1
    castStopped = true
  }

  // CastContext is a process-wide singleton, so listeners left behind
  // accumulate on every remount (channel switch, retry, refresh)
  if (listeningContext) {
    listeningContext.removeEventListener(
      cast.framework.CastContextEventType.CAST_STATE_CHANGED,
      handleCastStateChanged
    )

    listeningContext.removeEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      handleSessionStateChanged
    )

    remoteController?.removeEventListener(
      cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
      handlePlayerConnectedChanged
    )

    remoteController?.removeEventListener(
      cast.framework.RemotePlayerEventType.IS_MEDIA_LOADED_CHANGED,
      handleMediaLoadedChanged
    )

    remoteController?.removeEventListener(
      cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
      handlePlayerStateChanged
    )

    remoteController?.removeEventListener(
      cast.framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
      handleReceiverVolumeChanged
    )

    remoteController?.removeEventListener(
      cast.framework.RemotePlayerEventType.IS_MUTED_CHANGED,
      handleReceiverVolumeChanged
    )
    listeningContext = null
  }
}

/**
 * Initialize the Cast SDK when it becomes available
 */
function initializeCast(token: number) {
  const isCurrent = () => token === initToken

  // Wait for Cast SDK to load
  const checkCastAvailable = () => {
    return (
      typeof cast !== 'undefined' &&
      typeof cast.framework !== 'undefined' &&
      typeof chrome !== 'undefined' &&
      typeof chrome.cast !== 'undefined'
    )
  }

  // Poll for SDK availability (loads async)
  let attempts = 0
  const maxAttempts = 20
  const pollInterval = 250

  const waitForSdk = () => {
    if (!isCurrent()) return

    if (checkCastAvailable()) {
      logger.info('Cast', 'Cast SDK loaded, initializing')
      initializeCastContext()
    } else if (attempts < maxAttempts) {
      attempts++
      if (attempts === 1 || attempts % 5 === 0) {
        logger.debug('Cast', `Waiting for Cast SDK... attempt ${attempts}/${maxAttempts}`)
      }
      setTimeout(waitForSdk, pollInterval)
    } else {
      logger.warn('Cast', 'Cast SDK not available after timeout - is the script loaded?')
      setCastState({ isAvailable: false, isLoading: false })
    }
  }

  waitForSdk()
}

function initializeCastContext() {
  try {
    const context = cast.framework.CastContext.getInstance()

    // Configure with Default Media Receiver
    context.setOptions({
      receiverApplicationId: DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: 'ORIGIN_SCOPED' as chrome.cast.AutoJoinPolicy,
    })

    // Create remote player and controller
    remotePlayer = new (cast.framework as unknown as { RemotePlayer: new () => cast.framework.RemotePlayer }).RemotePlayer()
    remoteController = new cast.framework.RemotePlayerController(remotePlayer)

    // Listen for cast state changes
    context.addEventListener(
      cast.framework.CastContextEventType.CAST_STATE_CHANGED,
      handleCastStateChanged
    )

    context.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      handleSessionStateChanged
    )

    // Listen for player state changes
    remoteController.addEventListener(
      cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
      handlePlayerConnectedChanged
    )

    remoteController.addEventListener(
      cast.framework.RemotePlayerEventType.IS_MEDIA_LOADED_CHANGED,
      handleMediaLoadedChanged
    )

    remoteController.addEventListener(
      cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
      handlePlayerStateChanged
    )

    // The receiver's volume, for the casting card
    remoteController.addEventListener(
      cast.framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
      handleReceiverVolumeChanged
    )

    remoteController.addEventListener(
      cast.framework.RemotePlayerEventType.IS_MUTED_CHANGED,
      handleReceiverVolumeChanged
    )

    listeningContext = context
    if (!context.getCurrentSession()) {
      castGeneration += 1
      castStopped = true
      void releaseSession(currentSessionId)
    }

    // Check initial state
    const castState = context.getCastState()
    const isAvailable = castState !== cast.framework.CastState.NO_DEVICES_AVAILABLE

    logger.info('Cast', `Cast SDK initialized, state: ${castState}, devices available: ${isAvailable}`)

    setCastState({
      isAvailable,
      isConnected: Boolean(context.getCurrentSession() && remotePlayer?.isConnected),
      isCasting: Boolean(remotePlayer?.isMediaLoaded && remotePlayer?.playerState !== 'IDLE'),
      playerState: remotePlayer?.playerState ?? null,
      deviceName: context.getCurrentSession()?.getCastDevice()?.friendlyName ?? null,
      receiverVolume: remotePlayer?.volumeLevel ?? 1,
      receiverMuted: remotePlayer?.isMuted ?? false,
      isLoading: false,
    })
  } catch (error) {
    // The button stays hidden, so there is nothing for the viewer to act on
    logger.error('Cast', 'Failed to initialize Cast SDK', { error })
    setCastState({ isAvailable: false, isLoading: false })
  }
}

function handleCastStateChanged(event: cast.framework.CastStateEventData) {
  const { castState } = event
  logger.debug('Cast', `Cast state changed: ${castState}`)

  const isAvailable = castState !== cast.framework.CastState.NO_DEVICES_AVAILABLE
  const isConnected = castState === cast.framework.CastState.CONNECTED

  setCastState({
    isAvailable,
    isConnected,
    deviceName: isConnected
      ? cast.framework.CastContext.getInstance().getCurrentSession()?.getCastDevice()?.friendlyName ?? null
      : null,
  })
}

function handleSessionStateChanged(event: cast.framework.SessionStateEventData) {
  const { sessionState } = event
  logger.debug('Cast', `Session state changed: ${sessionState}`)

  if (
    sessionState === cast.framework.SessionState.SESSION_STARTED ||
    sessionState === cast.framework.SessionState.SESSION_RESUMED
  ) {
    // Session just connected — auto-cast if we have pending params
    const pending = pendingCast
    if (pending) {
      pendingCast = null
      logger.info('Cast', 'Session started, auto-casting pending stream')
      startCasting(
        pending.channelId,
        pending.streamType,
        pending.streamUrl,
        pending.title,
        pending.followsLive
      ).catch((err) => {
        logger.error('Cast', 'Auto-cast failed', { error: err })
      })
    }
  }

  if (
    sessionState === cast.framework.SessionState.SESSION_ENDED ||
    sessionState === cast.framework.SessionState.NO_SESSION
  ) {
    // Session ended - cleanup backend session if we have one. Clearing the
    // id first keeps this idempotent.
    castGeneration += 1
    castStopped = true
    void releaseSession(currentSessionId)
    pendingCast = null

    setCastState({
      isConnected: false,
      isCasting: false,
      deviceName: null,
    })
  }
}

function handlePlayerConnectedChanged() {
  if (!remotePlayer) return

  const isConnected = remotePlayer.isConnected
  logger.debug('Cast', `Player connected: ${isConnected}`)

  setCastState({
    isConnected,
    deviceName: isConnected
      ? cast.framework.CastContext.getInstance().getCurrentSession()?.getCastDevice()?.friendlyName ?? null
      : null,
  })
}

function handleMediaLoadedChanged() {
  if (!remotePlayer) return

  const isMediaLoaded = remotePlayer.isMediaLoaded
  logger.debug('Cast', `Media loaded: ${isMediaLoaded}`)

  setCastState({ isCasting: isMediaLoaded })
}

function handlePlayerStateChanged() {
  if (!remotePlayer) return

  const playerState = remotePlayer.playerState
  logger.info('Cast', `Player state changed: ${playerState}`)

  setCastState({ playerState: playerState ?? null })
  // If player goes IDLE after we were casting, media likely failed. Not when
  // this page stopped it (Stop clears isCasting first), or the session is
  // ending: those are someone's choice.
  const { isCasting, deviceName } = useCastStore.getState()
  if (playerState === 'IDLE' && isCasting) {
    setCastState({ isCasting: false })
    if (!isSessionEnding()) {
      reportError(`${deviceName ?? 'The Chromecast'} stopped playing`)
    }
  }
}

function handleReceiverVolumeChanged() {
  if (!remotePlayer) return

  setCastState({ receiverVolume: remotePlayer.volumeLevel, receiverMuted: remotePlayer.isMuted })
}

function isSessionEnding() {
  const sessionState = cast.framework.CastContext.getInstance().getSessionState()
  return (
    sessionState === cast.framework.SessionState.SESSION_ENDING ||
    sessionState === cast.framework.SessionState.SESSION_ENDED ||
    sessionState === cast.framework.SessionState.NO_SESSION
  )
}

/**
 * Request a cast session (show device picker).
 * If params are provided, auto-starts casting once the device connects.
 */
function requestSession(params?: CastParams) {
  if (typeof cast === 'undefined') return

  // Store params so handleSessionStateChanged can auto-cast on connect
  pendingCast = params ?? null

  const context = cast.framework.CastContext.getInstance()
  context.requestSession().catch((error: unknown) => {
    pendingCast = null
    // The SDK rejects with a chrome.cast.ErrorCode, a plain string: 'cancel'
    // when the viewer closes the picker without choosing a device
    const code = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
    // User cancelled is expected, don't show as error
    if (code.includes('cancel')) {
      logger.debug('Cast', 'User cancelled cast session request')
    } else {
      logger.error('Cast', 'Failed to request cast session', { error })
      reportError("Couldn't connect to the Chromecast")
    }
  })
}

/** The Chromecast fetches from its own network, so an app path needs the cast base URL */
function absoluteCastUrl(url: string): string {
  if (!url.startsWith('/')) return url
  // Remove /api suffix if present since the path already includes /api
  const absolute = `${getCastBaseUrl().replace(/\/api$/, '')}${url}`
  logger.debug('Cast', 'Converted relative URL to absolute', { original: url, absolute })
  return absolute
}

/**
 * Start casting a stream
 */
async function startCasting(
  channelId: string,
  streamType: 'hls' | 'mpegts',
  streamUrl?: string,
  title?: string,
  followsLive = false
) {
  if (typeof cast === 'undefined' || typeof chrome === 'undefined') {
    throw new Error('Cast SDK not available')
  }

  const context = cast.framework.CastContext.getInstance()
  const session = context.getCurrentSession()

  if (!session) {
    throw new Error('No active cast session')
  }

  const operation = ++castGeneration
  castStopped = false
  pendingOperation = operation
  const isCurrent = () => operation === castGeneration && context.getCurrentSession() === session
  let ownedSessionId: string | null = null
  await releaseSession(currentSessionId)
  if (!isCurrent()) return
  setCastState({ lastError: null })

  try {
    let hlsUrl: string

    if (streamType === 'hls' && streamUrl) {
      // HLS streams can be cast directly, but need absolute URL
      hlsUrl = absoluteCastUrl(streamUrl)
      logger.debug('Cast', 'Casting HLS stream directly', { channelId, hlsUrl })
    } else {
      // MPEG-TS streams need backend transcoding
      logger.debug('Cast', 'Creating backend transcoding session', { channelId, streamType })

      const castSession = await createCastSession(channelId, streamType, followsLive)
      ownedSessionId = castSession.session_id
      ownedSessions.add(ownedSessionId)
      if (!isCurrent()) { await releaseSession(ownedSessionId); return }
      currentSessionId = ownedSessionId

      if (castSession.needs_transcoding) {
        // Get the full HLS URL with auth token
        hlsUrl = getCastHlsUrl(castSession.session_id)
      } else {
        // Backend returned an ErsatzTV stream session's playlist path
        hlsUrl = absoluteCastUrl(castSession.hls_url)
      }
    }

    logger.info('Cast', `Loading media on Chromecast: ${hlsUrl}`, { title })

    // IMPORTANT: Chromecast needs to access this URL from its own network
    // If this is localhost or an internal IP, casting will fail!
    if (hlsUrl.includes('localhost') || hlsUrl.includes('127.0.0.1')) {
      logger.warn('Cast', 'HLS URL contains localhost - Chromecast cannot access this!')
    }

    // Create media info for Chromecast
    const mediaInfo = new chrome.cast.media.MediaInfo(hlsUrl, 'application/vnd.apple.mpegurl')
    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE
    mediaInfo.metadata = {
      title: title || 'Live Stream',
    }

    // Create load request
    const request = new chrome.cast.media.LoadRequest(mediaInfo)
    request.autoplay = true

    // Load media on Chromecast
    logger.debug('Cast', 'Calling session.loadMedia...')
    const loading = mediaLoadQueue.catch(() => {}).then(async () => {
      if (isCurrent()) await session.loadMedia(request)
    })
    mediaLoadQueue = loading
    await loading
    if (!isCurrent()) {
      // A receiver may finish an already-issued load after Stop. Complete
      // that cancellation once the SDK settles, without stopping a winner.
      if (castStopped && context.getCurrentSession() === session) remoteController?.stop()
      return
    }
    pendingOperation = null

    logger.info('Cast', 'Media load request sent successfully')

    // Check player state after a brief delay to detect immediate failures
    setTimeout(() => {
      if (isCurrent() && remotePlayer) {
        const ps = remotePlayer.playerState
        logger.info('Cast', `Post-load player state: ${ps}`)
        if (ps === 'IDLE' || ps === null) {
          logger.warn('Cast', 'Player is IDLE after loadMedia - media may have failed to load on Chromecast')
        }
      }
    }, 3000)

    setCastState({
      isCasting: true,
      playerState: remotePlayer?.playerState ?? null,
      lastError: null,
    })
  } catch (error) {
    logger.error('Cast', 'Failed to start casting', { error })

    // Only this operation can release its own backend resource.
    await releaseSession(ownedSessionId)
    if (!isCurrent()) return
    pendingOperation = null

    // The cause is in the log; the viewer gets plain words
    setCastState({ isCasting: false })
    reportError("Couldn't start casting. Try again.")

    throw error
  }
}

/**
 * Stop the current cast session
 */
export async function stopCasting() {
  if (typeof cast === 'undefined') return

  castGeneration += 1
  castStopped = true
  pendingCast = null
  // Before the receiver hears of it: the IDLE it reports is not a failure
  setCastState({ isCasting: false })

  // Stop playback on Chromecast
  if (remoteController) {
    remoteController.stop()
  }

  // Cleanup backend session
  const sessionId = currentSessionId
  if (sessionId) {
    currentSessionId = null
    await releaseSession(sessionId)
  }

  logger.info('Cast', 'Cast session stopped')
}

/**
 * Set the receiver's volume (0-1). The TV's level only: the viewer's saved
 * volume in the audio store is for this screen and stays as it is.
 */
export function setReceiverVolume(level: number) {
  if (!remotePlayer || !remoteController) return

  remotePlayer.volumeLevel = level
  remoteController.setVolumeLevel()
  setCastState({ receiverVolume: level })
  // Choosing a level unmutes, as the local slider does
  if (remotePlayer.isMuted && level > 0) {
    remoteController.muteOrUnmute()
    setCastState({ receiverMuted: false })
  }
}

/** Mute or unmute the receiver */
export function toggleReceiverMute() {
  if (!remotePlayer || !remoteController) return

  remoteController.muteOrUnmute()
  setCastState({ receiverMuted: !useCastStore.getState().receiverMuted })
}

/**
 * Cast a known-good public HLS stream for debugging.
 * If this works, the issue is with our stream/URL, not the Chromecast setup.
 */
async function castTestStream() {
  await startCasting('test-stream', 'hls', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'Test Stream (Big Buck Bunny)')
}

/**
 * Keep the Cast SDK initialised and listening while the caller is mounted,
 * without reading its state. The player shell holds it, so the listeners
 * outlive the engine (and the cast button in its controls): a channel change
 * or the reload after a cast stops doesn't set the SDK up again, and the
 * casting card on the empty live slot still hears the cast end.
 */
export function useCastSdk() {
  useEffect(acquireCast, [])
}

/**
 * Hook for managing Chromecast casting functionality.
 *
 * Every consumer shares one Cast SDK initialisation and one state (the cast
 * store): the first to mount initialises the SDK, later ones join it.
 *
 * Handles:
 * - Cast SDK initialization with Default Media Receiver
 * - Device connection/disconnection
 * - Media loading (HLS direct or MPEG-TS via backend transcoding)
 * - Session cleanup
 *
 * @example
 * ```tsx
 * const { isAvailable, isConnected, startCasting, requestSession } = useChromecast()
 *
 * // Show cast button only when available
 * if (!isAvailable) return null
 *
 * // Connect to device
 * <button onClick={requestSession}>Connect</button>
 *
 * // Start casting when connected
 * if (isConnected) {
 *   startCasting(channelId, 'mpegts', streamUrl, 'Channel Name')
 * }
 * ```
 */
export function useChromecast(): UseChromecastReturn {
  useCastSdk()

  const state = useCastStore(
    useShallow((s): ChromecastState => ({
      isLoading: s.isLoading,
      isAvailable: s.isAvailable,
      isConnected: s.isConnected,
      isCasting: s.isCasting,
      deviceName: s.deviceName,
      playerState: s.playerState,
      receiverVolume: s.receiverVolume,
      receiverMuted: s.receiverMuted,
      lastError: s.lastError,
    }))
  )

  return {
    ...state,
    startCasting,
    stopCasting,
    requestSession,
    castTestStream,
  }
}
