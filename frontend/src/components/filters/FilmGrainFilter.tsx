import { useEffect, useState, useRef } from 'react'

interface FilmGrainFilterProps {
  isActive: boolean
}

/**
 * Film Grain filter overlay - 8mm/16mm film aesthetic.
 * Features grain texture, subtle flicker, and slight vignette.
 */
export function FilmGrainFilter({ isActive }: FilmGrainFilterProps) {
  const [seed, setSeed] = useState(0)
  const [brightness, setBrightness] = useState(1)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flickerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Animate grain
  useEffect(() => {
    if (!isActive) return

    intervalRef.current = setInterval(() => {
      setSeed((prev) => (prev + 1) % 100)
    }, 80) // Slightly faster than retro TV for film feel

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isActive])

  // Subtle brightness flicker
  useEffect(() => {
    if (!isActive) return

    flickerRef.current = setInterval(() => {
      // Random brightness between 0.97 and 1.03
      setBrightness(0.97 + Math.random() * 0.06)
    }, 100)

    return () => {
      if (flickerRef.current) clearInterval(flickerRef.current)
    }
  }, [isActive])

  if (!isActive) return null

  return (
    <div
      className="film-grain-filter pointer-events-none absolute inset-0 z-10"
      style={{ filter: `brightness(${brightness})` }}
      role="presentation"
      aria-hidden="true"
    >
      {/* Film grain texture */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.08]"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter id={`film-grain-${seed}`} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="5"
              seed={seed}
              result="grain"
            />
            <feColorMatrix type="saturate" values="0" in="grain" result="mono" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#film-grain-${seed})`} />
      </svg>

      {/* Subtle warm vignette for film projector look */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 60%, rgba(20, 10, 0, 0.3) 100%)',
        }}
      />

      {/* Very subtle sepia/warm tint */}
      <div
        className="absolute inset-0 mix-blend-overlay opacity-10"
        style={{ backgroundColor: '#d4a574' }}
      />
    </div>
  )
}
