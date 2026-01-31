import { useEffect, useState } from 'react'

interface NoirIrisOverlayProps {
  isActive: boolean
}

/**
 * Noir iris wipe overlay - classic cinema iris/spotlight transition.
 * Circle opens from center revealing the content.
 */
export function NoirIrisOverlay({ isActive }: NoirIrisOverlayProps) {
  const [irisSize, setIrisSize] = useState(0)

  // Animate iris opening
  useEffect(() => {
    if (!isActive) {
      setIrisSize(0)
      return
    }

    // Start small and grow
    setIrisSize(0)
    const timer = setTimeout(() => {
      setIrisSize(150) // Grow to cover screen
    }, 50)

    return () => clearTimeout(timer)
  }, [isActive])

  if (!isActive) return null

  return (
    <div
      className="noir-iris-overlay pointer-events-none absolute inset-0 z-20"
      role="presentation"
      aria-hidden="true"
    >
      {/* Black background with circular cutout */}
      <div
        className="absolute inset-0 transition-all duration-1000 ease-out"
        style={{
          background: `radial-gradient(circle at center, transparent ${irisSize}%, black ${irisSize + 2}%)`,
        }}
      />

      {/* Spotlight glow at iris edge */}
      <div
        className="absolute inset-0 transition-all duration-1000 ease-out"
        style={{
          background: `radial-gradient(circle at center, transparent ${irisSize - 5}%, rgba(255,255,255,0.1) ${irisSize}%, transparent ${irisSize + 5}%)`,
        }}
      />

      {/* Film grain texture */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.08]"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter id="noir-iris-grain" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="1"
              numOctaves="4"
              seed={Date.now() % 100}
              result="grain"
            />
            <feColorMatrix type="saturate" values="0" in="grain" result="mono" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#noir-iris-grain)" />
      </svg>

      {/* Center text while iris is small */}
      {irisSize < 50 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-serif text-2xl italic text-neutral-400 opacity-80"
            style={{ textShadow: '0 0 20px rgba(255,255,255,0.3)' }}
          >
            Loading...
          </span>
        </div>
      )}
    </div>
  )
}
