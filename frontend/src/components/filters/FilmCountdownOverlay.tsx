import { useEffect, useState, useRef } from 'react'

interface FilmCountdownOverlayProps {
  isActive: boolean
}

/**
 * Film countdown leader overlay for Film Grain filter.
 * Classic cinema countdown with circle, crosshairs, and numbers.
 */
export function FilmCountdownOverlay({ isActive }: FilmCountdownOverlayProps) {
  const [count, setCount] = useState(5)
  const [flicker, setFlicker] = useState(1)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flickerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Countdown timer
  useEffect(() => {
    if (!isActive) {
      setCount(5)
      return
    }

    intervalRef.current = setInterval(() => {
      setCount((prev) => (prev > 1 ? prev - 1 : 5))
    }, 400)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isActive])

  // Film flicker effect
  useEffect(() => {
    if (!isActive) return

    flickerRef.current = setInterval(() => {
      setFlicker(0.85 + Math.random() * 0.3)
    }, 60)

    return () => {
      if (flickerRef.current) clearInterval(flickerRef.current)
    }
  }, [isActive])

  if (!isActive) return null

  return (
    <div
      className="film-countdown-overlay pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-neutral-900"
      style={{ opacity: flicker }}
      role="presentation"
      aria-hidden="true"
    >
      {/* Film grain texture */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Countdown circle */}
      <div className="relative h-64 w-64">
        {/* Outer circle */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
          {/* Main circle */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="#e5e5e5"
            strokeWidth="3"
          />

          {/* Crosshairs */}
          <line x1="50" y1="5" x2="50" y2="25" stroke="#e5e5e5" strokeWidth="2" />
          <line x1="50" y1="75" x2="50" y2="95" stroke="#e5e5e5" strokeWidth="2" />
          <line x1="5" y1="50" x2="25" y2="50" stroke="#e5e5e5" strokeWidth="2" />
          <line x1="75" y1="50" x2="95" y2="50" stroke="#e5e5e5" strokeWidth="2" />

          {/* Center dot */}
          <circle cx="50" cy="50" r="3" fill="#e5e5e5" />

          {/* Countdown arc - sweeps based on count */}
          <circle
            cx="50"
            cy="50"
            r="38"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="4"
            strokeDasharray={`${(6 - count) * 47.75} 239`}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            className="transition-all duration-300"
          />
        </svg>

        {/* Number */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-mono text-8xl font-bold text-neutral-100"
            style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}
          >
            {count}
          </span>
        </div>
      </div>

      {/* Film edge perforations */}
      <div className="absolute left-4 top-0 bottom-0 flex flex-col justify-around">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-6 w-4 rounded-sm bg-neutral-800 border border-neutral-600" />
        ))}
      </div>
      <div className="absolute right-4 top-0 bottom-0 flex flex-col justify-around">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-6 w-4 rounded-sm bg-neutral-800 border border-neutral-600" />
        ))}
      </div>

      {/* Vintage warm tint */}
      <div
        className="absolute inset-0 mix-blend-multiply opacity-30"
        style={{ backgroundColor: '#d4a574' }}
      />
    </div>
  )
}
