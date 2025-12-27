import { useState, useEffect, useRef } from 'react'
import mpegts from 'mpegts.js'
import { useChannelStore } from '@/stores/channelStore'

export function VideoPlayer() {
  const currentChannel = useChannelStore((s) => s.currentChannel)

  // No channel selected - show placeholder
  if (!currentChannel) {
    return <VideoPlayerPlaceholder />
  }

  // Using key prop to reset state when channel changes
  return (
    <VideoPlayerInner
      key={currentChannel.id}
      streamUrl={currentChannel.streamUrl}
    />
  )
}

function VideoPlayerInner({ streamUrl }: { streamUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<mpegts.Player | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBuffering, setIsBuffering] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Check mpegts.js support
    if (!mpegts.isSupported()) {
      setError('MPEG-TS playback not supported in this browser')
      return
    }

    // Create mpegts.js player
    const player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: streamUrl,
    })

    player.attachMediaElement(video)
    player.load()

    // Handle player events
    player.on(mpegts.Events.ERROR, () => {
      setError('Stream unavailable')
    })

    player.on(mpegts.Events.LOADING_COMPLETE, () => {
      setIsBuffering(false)
    })

    // Try to play
    video.play().catch(() => {
      // Autoplay blocked - user will need to click
    })

    playerRef.current = player

    // Handle video element events
    const handleWaiting = () => setIsBuffering(true)
    const handlePlaying = () => {
      setIsBuffering(false)
      setError(null)
    }
    const handleError = () => setError('Stream unavailable')

    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('error', handleError)

    return () => {
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('error', handleError)

      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [streamUrl])

  return (
    <div className="video-player-container relative aspect-video w-full bg-black">
      <video
        ref={videoRef}
        controls
        autoPlay
        className="h-full w-full"
      />

      {/* Buffering overlay */}
      <BufferingOverlay isVisible={isBuffering} />

      {/* Error overlay on top of player */}
      {error && <ErrorOverlay message={error} />}
    </div>
  )
}

export function BufferingOverlay({ isVisible }: { isVisible: boolean }) {
  if (!isVisible) return null

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-white border-t-transparent" />
    </div>
  )
}

export function ErrorOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80">
      <div className="rounded-lg bg-destructive/20 p-6 text-center">
        <p className="text-xl font-semibold text-destructive-foreground">
          {message}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Select another channel from the list
        </p>
      </div>
    </div>
  )
}

function VideoPlayerPlaceholder() {
  return (
    <div className="flex aspect-video w-full items-center justify-center bg-black">
      <p className="text-lg text-muted-foreground">No channel selected</p>
    </div>
  )
}
