import { useEffect, useState, useRef } from 'react'

interface GrindhouseTransitionOverlayProps {
  isActive: boolean
}

interface BurnHole {
  id: number
  x: number
  y: number
  size: number
  growing: boolean
}

/**
 * Grindhouse transition overlay - damaged film reel effect.
 * Heavy static, burn holes expanding, frame jumping, splice marks.
 */
export function GrindhouseTransitionOverlay({ isActive }: GrindhouseTransitionOverlayProps) {
  const [seed, setSeed] = useState(0)
  const [frameOffset, setFrameOffset] = useState(0)
  const [burnHoles, setBurnHoles] = useState<BurnHole[]>([])
  const [showSplice, setShowSplice] = useState(false)
  const [showFlash, setShowFlash] = useState(false)

  const grainRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const jumpRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const burnRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const spliceRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Rapid grain animation
  useEffect(() => {
    if (!isActive) return

    grainRef.current = setInterval(() => {
      setSeed((prev) => (prev + 1) % 100)
    }, 40)

    return () => {
      if (grainRef.current) clearInterval(grainRef.current)
    }
  }, [isActive])

  // Frame jumping/instability
  useEffect(() => {
    if (!isActive) {
      setFrameOffset(0)
      return
    }

    jumpRef.current = setInterval(() => {
      setFrameOffset(Math.random() * 10 - 5)
    }, 80)

    return () => {
      if (jumpRef.current) clearInterval(jumpRef.current)
    }
  }, [isActive])

  // Burn holes appearing and growing
  useEffect(() => {
    if (!isActive) {
      setBurnHoles([])
      return
    }

    // Initial burn holes
    setBurnHoles([
      { id: 1, x: 20 + Math.random() * 60, y: 20 + Math.random() * 60, size: 5, growing: true },
      { id: 2, x: 20 + Math.random() * 60, y: 20 + Math.random() * 60, size: 3, growing: true },
    ])

    burnRef.current = setInterval(() => {
      setBurnHoles((prev) =>
        prev.map((hole) => ({
          ...hole,
          size: hole.growing ? hole.size + 2 : hole.size,
          growing: hole.size < 30,
        }))
      )
    }, 100)

    return () => {
      if (burnRef.current) clearInterval(burnRef.current)
    }
  }, [isActive])

  // Splice marks and flashes
  useEffect(() => {
    if (!isActive) return

    spliceRef.current = setInterval(() => {
      if (Math.random() < 0.3) {
        setShowSplice(true)
        setTimeout(() => setShowSplice(false), 50)
      }
      if (Math.random() < 0.15) {
        setShowFlash(true)
        setTimeout(() => setShowFlash(false), 30)
      }
    }, 200)

    return () => {
      if (spliceRef.current) clearInterval(spliceRef.current)
    }
  }, [isActive])

  if (!isActive) return null

  return (
    <div
      className="grindhouse-transition-overlay pointer-events-none absolute inset-0 z-20 overflow-hidden bg-neutral-950"
      style={{ transform: `translateY(${frameOffset}px)` }}
      role="presentation"
      aria-hidden="true"
    >
      {/* Heavy static/snow */}
      <svg
        className="absolute inset-0 h-full w-full opacity-40"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter id={`grindhouse-static-${seed}`} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="3"
              seed={seed}
              result="noise"
            />
            <feColorMatrix type="saturate" values="0" in="noise" result="mono" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#grindhouse-static-${seed})`} />
      </svg>

      {/* Burn holes */}
      {burnHoles.map((hole) => (
        <div
          key={hole.id}
          className="absolute rounded-full"
          style={{
            left: `${hole.x}%`,
            top: `${hole.y}%`,
            width: `${hole.size}vmin`,
            height: `${hole.size}vmin`,
            background: `radial-gradient(circle,
              rgba(139, 69, 19, 0.9) 0%,
              rgba(100, 50, 10, 0.8) 30%,
              rgba(50, 25, 5, 0.6) 60%,
              transparent 100%)`,
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 20px rgba(255, 100, 0, 0.5)',
          }}
        />
      ))}

      {/* Horizontal splice line */}
      {showSplice && (
        <div
          className="absolute left-0 right-0 h-4 bg-white/30"
          style={{ top: `${30 + Math.random() * 40}%` }}
        />
      )}

      {/* Flash frame */}
      {showFlash && <div className="absolute inset-0 bg-white/40" />}

      {/* Film edge damage */}
      <div
        className="absolute top-0 left-0 right-0 h-8"
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)',
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-8"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
        }}
      />

      {/* "MISSING REEL" text - occasionally visible */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <p
            className="font-mono text-3xl font-bold text-amber-200/80 tracking-widest"
            style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}
          >
            REEL MISSING
          </p>
          <p className="mt-2 font-mono text-lg text-amber-200/60">
            PLEASE STAND BY
          </p>
        </div>
      </div>

      {/* Color bleeding on edges */}
      <div
        className="absolute inset-0"
        style={{
          boxShadow: 'inset 5px 0 30px rgba(255,0,0,0.2), inset -5px 0 30px rgba(0,255,255,0.2)',
        }}
      />
    </div>
  )
}
