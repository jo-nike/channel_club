import { useRef, useState, useCallback } from 'react'
import {
  MediaPlayer,
  MediaProvider,
  type MediaPlayerInstance,
} from '@vidstack/react'
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import { ProjectorBeamLoader } from '@/components/ProjectorBeamLoader'

interface HLSVideoPlayerProps {
  streamUrl: string
  title?: string
  onError?: (error: Error) => void
  onReady?: () => void
}

// Inner component that manages player state - remounts when streamUrl changes
function HLSVideoPlayerInner({ streamUrl, title, onError, onReady }: HLSVideoPlayerProps) {
  const playerRef = useRef<MediaPlayerInstance>(null)
  const [isBuffering, setIsBuffering] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleError = useCallback((e: { message?: string }) => {
    const errorMessage = e.message || 'Playback error'
    setError('Stream unavailable')
    onError?.(new Error(errorMessage))
  }, [onError])

  const handlePlaying = useCallback(() => {
    setIsBuffering(false)
    onReady?.()
  }, [onReady])

  const handleWaiting = useCallback(() => {
    setIsBuffering(true)
  }, [])

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <div className="rounded-lg bg-destructive/20 p-6 text-center">
          <p className="text-xl font-semibold text-destructive-foreground">{error}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Select another channel from the list
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-black">
      <MediaPlayer
        ref={playerRef}
        src={streamUrl}
        title={title}
        autoPlay
        playsInline
        className="h-full w-full"
        onWaiting={handleWaiting}
        onPlaying={handlePlaying}
        onError={handleError}
        data-testid="media-player"
      >
        <MediaProvider />
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>

      {/* Buffering overlay */}
      {isBuffering && <ProjectorBeamLoader />}
    </div>
  )
}

// Wrapper component that remounts the player when streamUrl changes
// This ensures clean state reset without useEffect setState
export function HLSVideoPlayer(props: HLSVideoPlayerProps) {
  return <HLSVideoPlayerInner key={props.streamUrl} {...props} />
}
