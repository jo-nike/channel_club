import { useState, useRef, useEffect } from 'react'
import type { MediaType } from '@/lib/mediaDetection'

export interface ChatMediaEmbedProps {
  url: string
  type: MediaType
  onError?: () => void
}

/**
 * Renders embedded media content (GIF, video, or image) in chat messages
 * Handles loading states, errors, and applies size constraints
 */
export function ChatMediaEmbed({ url, type, onError }: ChatMediaEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Handle video viewport-based autoplay
  useEffect(() => {
    if (type !== 'video' || !videoRef.current) return

    const video = videoRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            video.play().catch(() => {
              // Autoplay might be blocked, that's fine
            })
          } else {
            video.pause()
          }
        })
      },
      { threshold: 0.5 }
    )

    observer.observe(video)
    return () => observer.disconnect()
  }, [type])

  const handleError = () => {
    setError(true)
    setLoading(false)
    onError?.()
  }

  const handleLoad = () => {
    setLoading(false)
  }

  // Error fallback - show clickable link
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

  // Shared styling for media elements
  const mediaClasses = 'max-w-64 max-h-48 rounded object-contain'

  // Image types (gif, image)
  if (type === 'gif' || type === 'image') {
    return (
      <div className="relative inline-block">
        {loading && (
          <div className="absolute inset-0 bg-muted animate-pulse rounded" />
        )}
        <img
          src={url}
          alt="Shared media"
          loading="lazy"
          className={mediaClasses}
          onLoad={handleLoad}
          onError={handleError}
        />
      </div>
    )
  }

  // Video types (gifv, webm, mp4)
  return (
    <div className="relative inline-block">
      {loading && (
        <div className="absolute inset-0 bg-muted animate-pulse rounded" />
      )}
      <video
        ref={videoRef}
        src={url}
        loop
        muted
        autoPlay
        playsInline
        className={mediaClasses}
        onLoadedData={handleLoad}
        onError={handleError}
      />
    </div>
  )
}
