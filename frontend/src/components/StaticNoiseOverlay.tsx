import { useEffect, useState, useRef } from 'react'

interface StaticNoiseOverlayProps {
  /** Whether the overlay is visible */
  isVisible: boolean
}

/**
 * SVG-based static noise effect overlay.
 * Uses <feTurbulence> for GPU-accelerated noise generation with rapid animation.
 */
export function StaticNoiseOverlay({ isVisible }: StaticNoiseOverlayProps) {
  // Animate seed value for noise variation
  const [seed, setSeed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clear interval helper to prevent race conditions
  const clearIntervalSafe = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  useEffect(() => {
    // Always clear any existing interval first
    clearIntervalSafe()

    if (!isVisible) return

    // Rapid seed changes for TV static effect (0.1s interval)
    intervalRef.current = setInterval(() => {
      setSeed((prev) => (prev + 1) % 100)
    }, 100)

    return clearIntervalSafe
  }, [isVisible])

  if (!isVisible) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 will-change-transform"
      role="status"
      aria-label="Channel switching"
    >
      {/* Semi-transparent dark background */}
      <div className="absolute inset-0 bg-black/70" />

      {/* SVG noise filter - GPU accelerated */}
      <svg
        className="absolute inset-0 h-full w-full animate-static-grain"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter id={`noise-${seed}`} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.6"
              numOctaves="3"
              seed={seed}
              result="noise"
            />
            <feColorMatrix
              type="saturate"
              values="0"
              in="noise"
              result="mono"
            />
          </filter>
        </defs>
        <rect
          width="100%"
          height="100%"
          filter={`url(#noise-${seed})`}
          opacity="0.35"
        />
      </svg>
    </div>
  )
}
