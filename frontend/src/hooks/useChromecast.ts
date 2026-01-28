import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getCastFeatureEnabled,
  createCastSession,
  stopCastSession,
  getCastHlsUrl,
  getCastBaseUrl,
} from '@/services/api'
import { logger } from '@/lib/logger'

/**
 * Chromecast state managed by the hook
 */
export interface ChromecastState {
  /** Cast SDK loaded and feature enabled on server */
  isAvailable: boolean
  /** Connected to a Chromecast device */
  isConnected: boolean
  /** Media currently playing on Chromecast */
  isCasting: boolean
  /** Connected device name */
  deviceName: string | null
  /** Last error message */
  error: string | null
  /** Loading state */
  isLoading: boolean
  /** Remote player state (IDLE, BUFFERING, PLAYING, PAUSED) */
  playerState: string | null
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
    title?: string
  ) => Promise<void>
  /** Stop the current cast session */
  stopCasting: () => Promise<void>
  /** Show the Cast device picker dialog. If params provided, auto-casts on connect. */
  requestSession: (params?: {
    channelId: string
    streamType: 'hls' | 'mpegts'
    streamUrl?: string
    title?: string
  }) => void
  /** Cast a public test stream for debugging (call from browser console) */
  castTestStream: () => Promise<void>
}

// Default Media Receiver app ID (Google's default receiver that supports HLS)
const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845'

/**
 * Hook for managing Chromecast casting functionality.
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
  const [state, setState] = useState<ChromecastState>({
    isAvailable: false,
    isConnected: false,
    isCasting: false,
    deviceName: null,
    error: null,
    isLoading: true,
    playerState: null,
  })

  // Track current cast session for cleanup
  const currentSessionId = useRef<string | null>(null)
  const playerRef = useRef<cast.framework.RemotePlayer | null>(null)
  const controllerRef = useRef<cast.framework.RemotePlayerController | null>(null)

  // Store pending cast params for auto-casting after device selection
  const pendingCastRef = useRef<{
    channelId: string
    streamType: 'hls' | 'mpegts'
    streamUrl?: string
    title?: string
  } | null>(null)
  // Ref to startCasting so the session listener can call it without stale closures
  const startCastingRef = useRef<UseChromecastReturn['startCasting'] | null>(null)

  /**
   * Initialize the Cast SDK when it becomes available
   */
  useEffect(() => {
    let mounted = true

    async function initializeCast() {
      // First check if server has cast feature enabled
      let featureEnabled = false
      try {
        featureEnabled = await getCastFeatureEnabled()
      } catch (err) {
        logger.error('Cast', 'Failed to check cast feature', { error: err })
      }

      logger.info('Cast', `Server cast feature enabled: ${featureEnabled}`)

      if (!featureEnabled) {
        logger.debug('Cast', 'Cast feature disabled on server')
        if (mounted) {
          setState((s) => ({ ...s, isAvailable: false, isLoading: false }))
        }
        return
      }

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
        if (!mounted) return

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
          if (mounted) {
            setState((s) => ({ ...s, isAvailable: false, isLoading: false }))
          }
        }
      }

      waitForSdk()
    }

    function initializeCastContext() {
      if (!mounted) return

      try {
        const context = cast.framework.CastContext.getInstance()

        // Configure with Default Media Receiver
        context.setOptions({
          receiverApplicationId: DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: 'ORIGIN_SCOPED' as chrome.cast.AutoJoinPolicy,
        })

        // Create remote player and controller
        playerRef.current = new (cast.framework as unknown as { RemotePlayer: new () => cast.framework.RemotePlayer }).RemotePlayer()
        controllerRef.current = new cast.framework.RemotePlayerController(playerRef.current)

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
        controllerRef.current.addEventListener(
          cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
          handlePlayerConnectedChanged
        )

        controllerRef.current.addEventListener(
          cast.framework.RemotePlayerEventType.IS_MEDIA_LOADED_CHANGED,
          handleMediaLoadedChanged
        )

        controllerRef.current.addEventListener(
          cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
          handlePlayerStateChanged
        )

        // Check initial state
        const castState = context.getCastState()
        const isAvailable = castState !== cast.framework.CastState.NO_DEVICES_AVAILABLE

        logger.info('Cast', `Cast SDK initialized, state: ${castState}, devices available: ${isAvailable}`)

        if (mounted) {
          setState((s) => ({
            ...s,
            isAvailable,
            isLoading: false,
          }))
        }
      } catch (error) {
        logger.error('Cast', 'Failed to initialize Cast SDK', { error })
        if (mounted) {
          setState((s) => ({
            ...s,
            isAvailable: false,
            isLoading: false,
            error: 'Failed to initialize Cast SDK',
          }))
        }
      }
    }

    function handleCastStateChanged(event: cast.framework.CastStateEventData) {
      if (!mounted) return

      const { castState } = event
      logger.debug('Cast', `Cast state changed: ${castState}`)

      const isAvailable = castState !== cast.framework.CastState.NO_DEVICES_AVAILABLE
      const isConnected = castState === cast.framework.CastState.CONNECTED

      setState((s) => ({
        ...s,
        isAvailable,
        isConnected,
        deviceName: isConnected
          ? cast.framework.CastContext.getInstance().getCurrentSession()?.getCastDevice()?.friendlyName ?? null
          : null,
      }))
    }

    function handleSessionStateChanged(event: cast.framework.SessionStateEventData) {
      if (!mounted) return

      const { sessionState } = event
      logger.debug('Cast', `Session state changed: ${sessionState}`)

      if (
        sessionState === cast.framework.SessionState.SESSION_STARTED ||
        sessionState === cast.framework.SessionState.SESSION_RESUMED
      ) {
        // Session just connected — auto-cast if we have pending params
        const pending = pendingCastRef.current
        if (pending && startCastingRef.current) {
          pendingCastRef.current = null
          logger.info('Cast', 'Session started, auto-casting pending stream')
          startCastingRef.current(
            pending.channelId,
            pending.streamType,
            pending.streamUrl,
            pending.title
          ).catch((err) => {
            logger.error('Cast', 'Auto-cast failed', { error: err })
          })
        }
      }

      if (
        sessionState === cast.framework.SessionState.SESSION_ENDED ||
        sessionState === cast.framework.SessionState.NO_SESSION
      ) {
        // Session ended - cleanup backend session if we have one
        if (currentSessionId.current) {
          stopCastSession(currentSessionId.current).catch(() => {
            // Ignore cleanup errors
          })
          currentSessionId.current = null
        }
        pendingCastRef.current = null

        setState((s) => ({
          ...s,
          isConnected: false,
          isCasting: false,
          deviceName: null,
        }))
      }
    }

    function handlePlayerConnectedChanged() {
      if (!mounted || !playerRef.current) return

      const isConnected = playerRef.current.isConnected
      logger.debug('Cast', `Player connected: ${isConnected}`)

      setState((s) => ({
        ...s,
        isConnected,
        deviceName: isConnected
          ? cast.framework.CastContext.getInstance().getCurrentSession()?.getCastDevice()?.friendlyName ?? null
          : null,
      }))
    }

    function handleMediaLoadedChanged() {
      if (!mounted || !playerRef.current) return

      const isMediaLoaded = playerRef.current.isMediaLoaded
      logger.debug('Cast', `Media loaded: ${isMediaLoaded}`)

      setState((s) => ({
        ...s,
        isCasting: isMediaLoaded,
      }))
    }

    function handlePlayerStateChanged() {
      if (!mounted || !playerRef.current) return

      const playerState = playerRef.current.playerState
      logger.info('Cast', `Player state changed: ${playerState}`)

      setState((s) => ({
        ...s,
        playerState: playerState ?? null,
        // If player goes IDLE after we were casting, media likely failed
        ...(playerState === 'IDLE' && s.isCasting
          ? { isCasting: false, error: 'Chromecast playback stopped (IDLE)' }
          : {}),
      }))
    }

    initializeCast()

    return () => {
      mounted = false
      // Cleanup listeners would go here if needed
    }
  }, [])

  /**
   * Request a cast session (show device picker).
   * If params are provided, auto-starts casting once the device connects.
   */
  const requestSession = useCallback(
    (params?: {
      channelId: string
      streamType: 'hls' | 'mpegts'
      streamUrl?: string
      title?: string
    }) => {
      if (typeof cast === 'undefined') return

      // Store params so handleSessionStateChanged can auto-cast on connect
      pendingCastRef.current = params ?? null

      const context = cast.framework.CastContext.getInstance()
      context.requestSession().catch((error: Error) => {
        pendingCastRef.current = null
        // User cancelled is expected, don't show as error
        if (error.message?.includes('cancel')) {
          logger.debug('Cast', 'User cancelled cast session request')
        } else {
          logger.error('Cast', 'Failed to request cast session', { error })
          setState((s) => ({
            ...s,
            error: 'Failed to connect to Chromecast',
          }))
        }
      })
    },
    []
  )

  /**
   * Start casting a stream
   */
  const startCasting = useCallback(
    async (
      channelId: string,
      streamType: 'hls' | 'mpegts',
      streamUrl?: string,
      title?: string
    ) => {
      if (typeof cast === 'undefined' || typeof chrome === 'undefined') {
        throw new Error('Cast SDK not available')
      }

      const context = cast.framework.CastContext.getInstance()
      const session = context.getCurrentSession()

      if (!session) {
        throw new Error('No active cast session')
      }

      setState((s) => ({ ...s, error: null }))

      try {
        let hlsUrl: string

        if (streamType === 'hls' && streamUrl) {
          // HLS streams can be cast directly, but need absolute URL
          // Convert relative URLs to absolute for Chromecast
          if (streamUrl.startsWith('/')) {
            const castBase = getCastBaseUrl()
            // Remove /api suffix if present since streamUrl already includes /api
            const baseWithoutApi = castBase.replace(/\/api$/, '')
            hlsUrl = `${baseWithoutApi}${streamUrl}`
            logger.debug('Cast', 'Converted relative URL to absolute', {
              original: streamUrl,
              absolute: hlsUrl,
            })
          } else {
            hlsUrl = streamUrl
          }
          logger.debug('Cast', 'Casting HLS stream directly', { channelId, hlsUrl })
        } else {
          // MPEG-TS streams need backend transcoding
          logger.debug('Cast', 'Creating backend transcoding session', { channelId, streamType })

          const castSession = await createCastSession(channelId, streamType, streamUrl)
          currentSessionId.current = castSession.session_id

          if (castSession.needs_transcoding) {
            // Get the full HLS URL with auth token
            hlsUrl = getCastHlsUrl(castSession.session_id)
          } else {
            // Backend returned the source URL directly (for HLS sources)
            hlsUrl = castSession.hls_url
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
        await session.loadMedia(request)

        logger.info('Cast', 'Media load request sent successfully')

        // Check player state after a brief delay to detect immediate failures
        setTimeout(() => {
          if (playerRef.current) {
            const ps = playerRef.current.playerState
            logger.info('Cast', `Post-load player state: ${ps}`)
            if (ps === 'IDLE' || ps === null) {
              logger.warn('Cast', 'Player is IDLE after loadMedia - media may have failed to load on Chromecast')
            }
          }
        }, 3000)

        setState((s) => ({
          ...s,
          isCasting: true,
          playerState: playerRef.current?.playerState ?? null,
          error: null,
        }))
      } catch (error) {
        logger.error('Cast', 'Failed to start casting', { error })

        // Cleanup backend session on failure
        if (currentSessionId.current) {
          stopCastSession(currentSessionId.current).catch(() => {})
          currentSessionId.current = null
        }

        setState((s) => ({
          ...s,
          isCasting: false,
          error: error instanceof Error ? error.message : 'Failed to start casting',
        }))

        throw error
      }
    },
    []
  )

  // Keep ref in sync for the session state listener
  startCastingRef.current = startCasting

  /**
   * Stop the current cast session
   */
  const stopCasting = useCallback(async () => {
    if (typeof cast === 'undefined') return

    // Stop playback on Chromecast
    if (controllerRef.current) {
      controllerRef.current.stop()
    }

    // Cleanup backend session
    if (currentSessionId.current) {
      await stopCastSession(currentSessionId.current)
      currentSessionId.current = null
    }

    setState((s) => ({
      ...s,
      isCasting: false,
    }))

    logger.info('Cast', 'Cast session stopped')
  }, [])

  /**
   * Cast a known-good public HLS stream for debugging.
   * If this works, the issue is with our stream/URL, not the Chromecast setup.
   */
  const castTestStream = useCallback(async () => {
    if (typeof cast === 'undefined' || typeof chrome === 'undefined') {
      throw new Error('Cast SDK not available')
    }

    const context = cast.framework.CastContext.getInstance()
    const session = context.getCurrentSession()

    if (!session) {
      throw new Error('No active cast session - connect to a device first')
    }

    // Apple's public HLS test stream (Big Buck Bunny)
    const testUrl = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'

    logger.info('Cast', `[TEST] Loading public test stream: ${testUrl}`)

    const mediaInfo = new chrome.cast.media.MediaInfo(testUrl, 'application/vnd.apple.mpegurl')
    mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED
    mediaInfo.metadata = { title: 'Test Stream (Big Buck Bunny)' }

    const request = new chrome.cast.media.LoadRequest(mediaInfo)
    request.autoplay = true

    await session.loadMedia(request)
    logger.info('Cast', '[TEST] Media load request sent')

    setTimeout(() => {
      if (playerRef.current) {
        const ps = playerRef.current.playerState
        logger.info('Cast', `[TEST] Post-load player state: ${ps}`)
      }
    }, 5000)
  }, [])

  return {
    ...state,
    startCasting,
    stopCasting,
    requestSession,
    castTestStream,
  }
}
