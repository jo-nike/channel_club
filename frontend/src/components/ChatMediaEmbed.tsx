import { useState, useRef, useEffect, useCallback } from 'react'
import { Play } from 'lucide-react'
import type { MediaType } from '@/lib/mediaDetection'

const MAX_LOOPS = 3
const GIF_PLAY_DURATION_MS = 8000 // ~3 loops for typical 2-3 second GIFs

export interface ChatMediaEmbedProps {
  url: string
  type: MediaType
  onError?: () => void
}

/**
 * Renders embedded media content (GIF, video, or image) in chat messages
 * Handles loading states, errors, loop control, and applies size constraints
 */
export function ChatMediaEmbed({ url, type, onError }: ChatMediaEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [loopCount, setLoopCount] = useState(0)
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Capture current frame of GIF to canvas for freezing
  const captureGifFrame = useCallback((): string | null => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return null

    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      // Set canvas size to match image
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height

      // Draw current frame
      ctx.drawImage(img, 0, 0)

      // Convert to data URL
      return canvas.toDataURL('image/png')
    } catch (e) {
      // Cross-origin error - fallback to null
      console.warn('Could not capture GIF frame:', e)
      return null
    }
  }, [])

  // Handle video loop counting and pausing after MAX_LOOPS
  const handleVideoEnded = useCallback(() => {
    const newCount = loopCount + 1
    setLoopCount(newCount)

    if (newCount >= MAX_LOOPS) {
      setIsPaused(true)
      videoRef.current?.pause()
    } else {
      if (videoRef.current) {
        videoRef.current.currentTime = 0
        videoRef.current.play().catch(() => {})
      }
    }
  }, [loopCount])

  // Handle video viewport-based autoplay
  useEffect(() => {
    if (type !== 'video' || !videoRef.current) return

    const video = videoRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isPaused) {
            video.play().catch(() => {})
          } else {
            video.pause()
          }
        })
      },
      { threshold: 0.5 }
    )

    observer.observe(video)
    return () => observer.disconnect()
  }, [type, isPaused])

  // Handle GIF timeout-based pause
  useEffect(() => {
    if (type !== 'gif' || loading || isPaused) return

    gifTimerRef.current = setTimeout(() => {
      // Capture frame before pausing
      const frame = captureGifFrame()
      setFrozenFrame(frame)
      setIsPaused(true)
    }, GIF_PLAY_DURATION_MS)

    return () => {
      if (gifTimerRef.current) {
        clearTimeout(gifTimerRef.current)
        gifTimerRef.current = null
      }
    }
  }, [type, loading, isPaused, captureGifFrame])

  const handleReplay = useCallback(() => {
    setIsPaused(false)
    setLoopCount(0)
    setFrozenFrame(null)

    if (type === 'video' && videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.play().catch(() => {})
    }
    // For GIFs, clearing frozenFrame will show the original img which restarts animation
  }, [type])

  const handleError = () => {
    setError(true)
    setLoading(false)
    onError?.()
  }

  const handleLoad = () => {
    setLoading(false)
  }

  if (error) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-500 underline text-sm hover:text-blue-400"
      >
        Media unavailable - click to open
      </a>
    )
  }

  const mediaClasses = 'max-w-64 max-h-48 w-auto rounded object-contain'

  // Inline replay overlay to avoid component-in-render lint error
  const replayOverlay = (
    <button
      onClick={handleReplay}
      className="absolute inset-0 flex items-center justify-center rounded cursor-pointer group"
      aria-label="Replay"
    >
      <div className="absolute inset-0 bg-black/30 rounded" />
      <div className="relative bg-white/95 rounded-full p-2.5 shadow-md group-hover:scale-110 transition-transform">
        <Play className="h-5 w-5 text-gray-700 fill-gray-700 ml-0.5" />
      </div>
    </button>
  )

  // GIF and image types
  if (type === 'gif' || type === 'image') {
    const showFrozen = isPaused && frozenFrame && type === 'gif'

    return (
      <div className="relative inline-block max-w-full overflow-hidden">
        {loading && (
          <div className="absolute inset-0 bg-muted animate-pulse rounded" />
        )}

        {/* Hidden canvas for frame capture */}
        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

        {showFrozen ? (
          // Show frozen frame when paused
          <img
            src={frozenFrame}
            alt="Paused"
            className={mediaClasses}
          />
        ) : (
          // Show animated GIF - crossOrigin allows canvas capture
          <img
            ref={imgRef}
            src={url}
            alt="Shared media"
            loading="lazy"
            crossOrigin="anonymous"
            className={mediaClasses}
            onLoad={handleLoad}
            onError={handleError}
          />
        )}

        {isPaused && type === 'gif' && replayOverlay}
      </div>
    )
  }

  // Video types
  return (
    <div className="relative inline-block max-w-full overflow-hidden">
      {loading && (
        <div className="absolute inset-0 bg-muted animate-pulse rounded" />
      )}
      <video
        ref={videoRef}
        src={url}
        muted
        autoPlay
        playsInline
        className={mediaClasses}
        onLoadedData={handleLoad}
        onError={handleError}
        onEnded={handleVideoEnded}
      />
      {isPaused && replayOverlay}
    </div>
  )
}
