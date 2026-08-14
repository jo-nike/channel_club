import { useEffect, useState, useRef } from 'react'

interface GrindhouseFilterProps {
  isActive: boolean
}

interface Scratch {
  id: number
  x: number
  width: number
  opacity: number
  duration: number
}

interface BurnMark {
  id: number
  x: number
  y: number
  size: number
  opacity: number
}

/**
 * Grindhouse filter overlay - damaged exploitation film aesthetic.
 * Features scratches, burn marks, color bleeding, and heavy grain.
 */
export function GrindhouseFilter({ isActive }: GrindhouseFilterProps) {
  const [seed, setSeed] = useState(0)
  const [scratches, setScratches] = useState<Scratch[]>([])
  const [burnMarks, setBurnMarks] = useState<BurnMark[]>([])
  const [showSplice, setShowSplice] = useState(false)
  const grainRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scratchRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const spliceRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Animate grain rapidly
  useEffect(() => {
    if (!isActive) return

    grainRef.current = setInterval(() => {
      setSeed((prev) => (prev + 1) % 100)
    }, 50)

    return () => {
      if (grainRef.current) clearInterval(grainRef.current)
    }
  }, [isActive])

  // Generate random scratches
  // Nothing renders while inactive and the generator runs again on reactivation,
  // so there is no stale state to clear here.
  useEffect(() => {
    if (!isActive) return

    const generateScratches = () => {
      const count = 2 + Math.floor(Math.random() * 4)
      const newScratches: Scratch[] = Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        width: 1 + Math.random() * 2,
        opacity: 0.1 + Math.random() * 0.3,
        duration: 0.1 + Math.random() * 0.2,
      }))
      setScratches(newScratches)
    }

    generateScratches()
    scratchRef.current = setInterval(generateScratches, 150)

    return () => {
      if (scratchRef.current) clearInterval(scratchRef.current)
    }
  }, [isActive])

  // Generate burn marks (less frequent)
  // Randomness cannot run during render (react-hooks/purity) and the component
  // stays mounted while inactive, so a lazy initializer would freeze the marks
  // for the whole session. Picking them on activation is what the effect is for.
  useEffect(() => {
    if (!isActive) return

    const marks: BurnMark[] = Array.from({ length: 3 }, (_, i) => ({
      id: i,
      x: 10 + Math.random() * 80,
      y: 10 + Math.random() * 80,
      size: 50 + Math.random() * 100,
      opacity: 0.05 + Math.random() * 0.1,
    }))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setBurnMarks(marks)
  }, [isActive])

  // Occasional splice/jump effect
  useEffect(() => {
    if (!isActive) return

    spliceRef.current = setInterval(() => {
      if (Math.random() < 0.05) {
        setShowSplice(true)
        setTimeout(() => setShowSplice(false), 50)
      }
    }, 500)

    return () => {
      if (spliceRef.current) clearInterval(spliceRef.current)
    }
  }, [isActive])

  if (!isActive) return null

  return (
    <div
      className="grindhouse-filter pointer-events-none absolute inset-0 z-10"
      role="presentation"
      aria-hidden="true"
    >
      {/* Heavy film grain */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.15]"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter id={`grindhouse-grain-${seed}`} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.8"
              numOctaves="4"
              seed={seed}
              result="grain"
            />
            <feColorMatrix type="saturate" values="0" in="grain" result="mono" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#grindhouse-grain-${seed})`} />
      </svg>

      {/* Vertical scratches */}
      {scratches.map((scratch) => (
        <div
          key={scratch.id}
          className="absolute top-0 bottom-0 bg-white/20"
          style={{
            left: `${scratch.x}%`,
            width: `${scratch.width}px`,
            opacity: scratch.opacity,
            animation: `scratch-flicker ${scratch.duration}s steps(2) infinite`,
          }}
        />
      ))}

      {/* Burn marks / cigarette burns */}
      {burnMarks.map((mark) => (
        <div
          key={mark.id}
          className="absolute rounded-full"
          style={{
            left: `${mark.x}%`,
            top: `${mark.y}%`,
            width: `${mark.size}px`,
            height: `${mark.size}px`,
            background: `radial-gradient(circle, rgba(139, 69, 19, ${mark.opacity}) 0%, transparent 70%)`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}

      {/* Color bleeding / misregistration */}
      <div
        className="absolute inset-0 mix-blend-screen opacity-[0.03]"
        style={{
          background: 'linear-gradient(90deg, rgba(255,0,0,1) 0%, transparent 3%, transparent 97%, rgba(0,255,255,1) 100%)',
        }}
      />

      {/* Aged/faded look - slightly desaturated and warm */}
      <div
        className="absolute inset-0 mix-blend-overlay opacity-20"
        style={{ backgroundColor: '#8b7355' }}
      />

      {/* Heavy vignette - projector gate */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.5) 100%)',
        }}
      />

      {/* Edge damage */}
      <div
        className="absolute inset-0"
        style={{
          boxShadow: 'inset 0 0 30px rgba(0,0,0,0.4), inset 0 0 60px rgba(0,0,0,0.2)',
        }}
      />

      {/* Splice/jump flash */}
      {showSplice && (
        <div className="absolute inset-0 bg-white/30" />
      )}
    </div>
  )
}
