import { useEffect, useState, useRef } from 'react'

interface VHSTrackingEffectProps {
  /** Whether the effect is active (shown during channel transitions when retro-tv filter enabled) */
  isActive: boolean
}

/**
 * VHS Tracking Effect overlay for enhanced channel switch transitions.
 * Displays wavy horizontal band distortions and enhanced static burst
 * when the retro-tv filter is active during channel changes.
 */
export function VHSTrackingEffect({ isActive }: VHSTrackingEffectProps) {
  const [bands, setBands] = useState<number[]>([])
  const [seed, setSeed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const seedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Generate random tracking bands
  useEffect(() => {
    if (!isActive) {
      setBands([])
      return
    }

    // Create 3-5 tracking bands at random positions
    const generateBands = () => {
      const count = 3 + Math.floor(Math.random() * 3)
      const newBands = Array.from({ length: count }, () => Math.random() * 100)
      setBands(newBands)
    }

    generateBands()

    // Update bands rapidly for glitchy effect
    intervalRef.current = setInterval(generateBands, 100)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isActive])

  // Animate static noise seed
  useEffect(() => {
    if (!isActive) return

    seedIntervalRef.current = setInterval(() => {
      setSeed((prev) => (prev + 1) % 100)
    }, 50) // Fast updates for intense static

    return () => {
      if (seedIntervalRef.current) {
        clearInterval(seedIntervalRef.current)
      }
    }
  }, [isActive])

  if (!isActive) return null

  return (
    <div
      className="vhs-tracking-effect pointer-events-none absolute inset-0 z-20"
      role="presentation"
      aria-hidden="true"
    >
      {/* Enhanced static burst - more intense than regular filter */}
      <svg
        className="absolute inset-0 h-full w-full animate-vhs-static-burst"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter id={`vhs-noise-${seed}`} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.7"
              numOctaves="3"
              seed={seed}
              result="noise"
            />
            <feColorMatrix type="saturate" values="0" in="noise" result="mono" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#vhs-noise-${seed})`} opacity="0.5" />
      </svg>

      {/* Wavy horizontal tracking bands */}
      {bands.map((position, index) => (
        <div
          key={`band-${index}`}
          className="vhs-tracking-band absolute left-0 right-0 animate-vhs-glitch"
          style={{
            top: `${position}%`,
            animationDelay: `${index * 30}ms`,
          }}
        />
      ))}

      {/* Horizontal color separation glitch lines */}
      <div className="absolute inset-0 overflow-hidden">
        {bands.slice(0, 2).map((position, index) => (
          <div
            key={`glitch-${index}`}
            className="absolute left-0 right-0 h-1"
            style={{
              top: `${position + 5}%`,
              background: index === 0
                ? 'linear-gradient(90deg, rgba(255,0,0,0.3) 0%, transparent 50%)'
                : 'linear-gradient(90deg, transparent 50%, rgba(0,0,255,0.3) 100%)',
              transform: `translateX(${index === 0 ? '-' : ''}${Math.random() * 5}px)`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
