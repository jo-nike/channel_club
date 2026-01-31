import { useEffect, useState, useRef } from 'react'

/**
 * Static noise overlay for the Retro TV filter effect.
 * Uses SVG feTurbulence for GPU-accelerated noise generation.
 * Lower opacity (5%) per Dev Notes for subtle background effect.
 */
function FilterStaticNoise() {
  const [seed, setSeed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Slower animation for ambient effect (500ms interval)
    intervalRef.current = setInterval(() => {
      setSeed((prev) => (prev + 1) % 100)
    }, 500)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  return (
    <svg
      className="absolute inset-0 h-full w-full opacity-5"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <filter id={`retro-noise-${seed}`} x="0%" y="0%" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.8"
            numOctaves="4"
            seed={seed}
            result="noise"
          />
          <feColorMatrix type="saturate" values="0" in="noise" result="mono" />
        </filter>
      </defs>
      <rect width="100%" height="100%" filter={`url(#retro-noise-${seed})`} opacity="0.4" />
    </svg>
  )
}

interface RetroTVFilterProps {
  /** Whether the filter is active */
  isActive: boolean
}

/**
 * Retro TV filter overlay with CRT scanlines, vignette, chromatic aberration,
 * and subtle static noise. All effects use CSS for performance.
 *
 * Layered effects:
 * 1. CRT scanlines (repeating horizontal lines)
 * 2. Vignette (radial gradient darkening corners)
 * 3. Chromatic aberration (RGB color separation)
 * 4. Static noise (SVG turbulence, very low opacity)
 */
export function RetroTVFilter({ isActive }: RetroTVFilterProps) {
  if (!isActive) return null

  return (
    <div
      className="retro-tv-filter pointer-events-none absolute inset-0 z-10"
      role="presentation"
      aria-hidden="true"
    >
      {/* CRT Scanlines - repeating horizontal lines */}
      <div className="absolute inset-0 bg-scanlines opacity-10" />

      {/* Vignette - darkened corners for CRT tube effect */}
      <div className="absolute inset-0 bg-vignette" />

      {/* Chromatic aberration - RGB color separation effect */}
      <div className="absolute inset-0 chromatic-aberration" />

      {/* Static noise - very subtle background texture */}
      <FilterStaticNoise />
    </div>
  )
}
