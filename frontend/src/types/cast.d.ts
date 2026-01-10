/**
 * TypeScript declarations for Google Cast SDK (CAF - Cast Application Framework)
 *
 * These declarations cover the subset of the Cast SDK used for casting media
 * to Chromecast devices using the Default Media Receiver.
 *
 * @see https://developers.google.com/cast/docs/reference/web_sender
 */

declare namespace cast {
  namespace framework {
    /** Cast state enum values */
    enum CastState {
      NO_DEVICES_AVAILABLE = 'NO_DEVICES_AVAILABLE',
      NOT_CONNECTED = 'NOT_CONNECTED',
      CONNECTING = 'CONNECTING',
      CONNECTED = 'CONNECTED',
    }

    /** Session state enum values */
    enum SessionState {
      NO_SESSION = 'NO_SESSION',
      SESSION_STARTING = 'SESSION_STARTING',
      SESSION_STARTED = 'SESSION_STARTED',
      SESSION_START_FAILED = 'SESSION_START_FAILED',
      SESSION_ENDING = 'SESSION_ENDING',
      SESSION_ENDED = 'SESSION_ENDED',
      SESSION_RESUMED = 'SESSION_RESUMED',
    }

    /** Remote player event type enum */
    enum RemotePlayerEventType {
      ANY_CHANGE = 'anyChanged',
      IS_CONNECTED_CHANGED = 'isConnectedChanged',
      IS_MEDIA_LOADED_CHANGED = 'isMediaLoadedChanged',
      DURATION_CHANGED = 'durationChanged',
      CURRENT_TIME_CHANGED = 'currentTimeChanged',
      IS_PAUSED_CHANGED = 'isPausedChanged',
      VOLUME_LEVEL_CHANGED = 'volumeLevelChanged',
      IS_MUTED_CHANGED = 'isMutedChanged',
      CAN_PAUSE_CHANGED = 'canPauseChanged',
      CAN_SEEK_CHANGED = 'canSeekChanged',
      DISPLAY_NAME_CHANGED = 'displayNameChanged',
      STATUS_TEXT_CHANGED = 'statusTextChanged',
      TITLE_CHANGED = 'titleChanged',
      DISPLAY_STATUS_CHANGED = 'displayStatusChanged',
      MEDIA_INFO_CHANGED = 'mediaInfoChanged',
      IMAGE_URL_CHANGED = 'imageUrlChanged',
      PLAYER_STATE_CHANGED = 'playerStateChanged',
    }

    /** Cast context options */
    interface CastOptions {
      receiverApplicationId: string
      autoJoinPolicy?: string
      resumeSavedSession?: boolean
    }

    /** Cast session */
    interface CastSession {
      getSessionId(): string
      getCastDevice(): { friendlyName: string }
      getSessionState(): SessionState
      loadMedia(request: chrome.cast.media.LoadRequest): Promise<void>
      endSession(stopCasting: boolean): void
    }

    /** Remote player state */
    interface RemotePlayer {
      isConnected: boolean
      isMediaLoaded: boolean
      isPaused: boolean
      isMuted: boolean
      currentTime: number
      duration: number
      volumeLevel: number
      displayName: string
      statusText: string
      title: string
      playerState: chrome.cast.media.PlayerState | null
      mediaInfo: chrome.cast.media.MediaInfo | null
    }

    /** Remote player event */
    interface RemotePlayerChangedEvent {
      field: string
      value: unknown
    }

    /** Remote player controller for controlling playback */
    class RemotePlayerController {
      constructor(player: RemotePlayer)
      addEventListener(
        type: RemotePlayerEventType,
        handler: (event: RemotePlayerChangedEvent) => void
      ): void
      removeEventListener(
        type: RemotePlayerEventType,
        handler: (event: RemotePlayerChangedEvent) => void
      ): void
      playOrPause(): void
      stop(): void
      seek(): void
      muteOrUnmute(): void
      setVolumeLevel(): void
    }

    /** Cast context singleton */
    class CastContext {
      static getInstance(): CastContext
      setOptions(options: CastOptions): void
      getCastState(): CastState
      getSessionState(): SessionState
      getCurrentSession(): CastSession | null
      requestSession(): Promise<void>
      endCurrentSession(stopCasting: boolean): void
      addEventListener(
        type: CastContextEventType,
        handler: (event: CastStateEventData | SessionStateEventData) => void
      ): void
      removeEventListener(
        type: CastContextEventType,
        handler: (event: CastStateEventData | SessionStateEventData) => void
      ): void
    }

    /** Event types for CastContext */
    enum CastContextEventType {
      CAST_STATE_CHANGED = 'caststatechanged',
      SESSION_STATE_CHANGED = 'sessionstatechanged',
    }

    /** Cast state change event data */
    interface CastStateEventData {
      castState: CastState
    }

    /** Session state change event data */
    interface SessionStateEventData {
      sessionState: SessionState
      session: CastSession | null
    }
  }
}

declare namespace chrome {
  namespace cast {
    /** Auto join policy for cast sessions */
    type AutoJoinPolicy = 'ORIGIN_SCOPED' | 'TAB_AND_ORIGIN_SCOPED' | 'PAGE_SCOPED'

    /** Default Media Receiver app ID */
    const media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: string

      /** Media info for loading content */
      MediaInfo: new (contentId: string, contentType: string) => MediaInfo

      /** Load request for loading media */
      LoadRequest: new (mediaInfo: MediaInfo) => LoadRequest

      /** Player state enum */
      PlayerState: {
        IDLE: 'IDLE'
        PLAYING: 'PLAYING'
        PAUSED: 'PAUSED'
        BUFFERING: 'BUFFERING'
      }

      /** Stream type enum */
      StreamType: {
        BUFFERED: 'BUFFERED'
        LIVE: 'LIVE'
        OTHER: 'OTHER'
      }
    }

    namespace media {
      interface MediaInfo {
        contentId: string
        contentType: string
        streamType: string
        metadata?: MediaMetadata
      }

      interface MediaMetadata {
        title?: string
        subtitle?: string
        images?: Array<{ url: string }>
      }

      interface LoadRequest {
        media: MediaInfo
        autoplay?: boolean
        currentTime?: number
      }

      type PlayerState = 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING'
    }

    /** Check if Cast API is available */
    const isAvailable: boolean
  }
}

/** Global cast namespace from the SDK */
declare const cast: typeof cast
declare const chrome: typeof chrome
