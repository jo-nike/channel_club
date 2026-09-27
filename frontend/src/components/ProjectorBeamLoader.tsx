import { useState } from 'react'

interface ProjectorBeamLoaderProps {
  /** Optional text to display below the loader */
  text?: string
}

interface Particle {
  id: number
  left: string
  top: string
  size: number
  duration: string
  delay: string
  opacity: number
}

// Generate particles outside of render to ensure purity
function generateParticles(): Particle[] {
  return Array.from({ length: 20 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    size: Math.random() * 3 + 1,
    duration: `${Math.random() * 3 + 2}s`,
    delay: `${Math.random() * 2}s`,
    opacity: Math.random() * 0.6 + 0.2,
  }))
}

// Under Reduce Motion the beams and reel stop and the dust is hidden. The
// animate-* classes are plain CSS outside Tailwind's layers, so animate-none
// needs the important modifier to win over them.
export function ProjectorBeamLoader({ text }: ProjectorBeamLoaderProps) {
  // useState with lazy initializer only runs once on mount
  const [particles] = useState<Particle[]>(generateParticles)

  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Projector beam - emanating from top-right corner */}
      <div className="projector-beam absolute inset-0">
        {/* Main light cone */}
        <div
          className="absolute animate-projector-flicker motion-reduce:animate-none!"
          style={{
            top: '-10%',
            right: '-10%',
            width: '120%',
            height: '120%',
            background: `
              conic-gradient(
                from 200deg at 100% 0%,
                transparent 0deg,
                rgba(255, 248, 220, 0.15) 15deg,
                rgba(255, 248, 220, 0.08) 35deg,
                transparent 50deg
              )
            `,
          }}
        />

        {/* Secondary softer glow */}
        <div
          className="absolute animate-projector-flicker-slow motion-reduce:animate-none!"
          style={{
            top: '-5%',
            right: '-5%',
            width: '110%',
            height: '110%',
            background: `
              conic-gradient(
                from 205deg at 100% 0%,
                transparent 0deg,
                rgba(255, 248, 220, 0.05) 20deg,
                rgba(255, 248, 220, 0.02) 40deg,
                transparent 55deg
              )
            `,
          }}
        />
      </div>

      {/* Floating dust particles */}
      <div className="absolute inset-0 motion-reduce:hidden">
        {particles.map((particle) => (
          <div
            key={particle.id}
            className="absolute animate-dust-float rounded-full bg-white/80"
            style={{
              left: particle.left,
              top: particle.top,
              width: particle.size,
              height: particle.size,
              opacity: particle.opacity,
              animationDuration: particle.duration,
              animationDelay: particle.delay,
            }}
          />
        ))}
      </div>

      {/* Central film reel icon */}
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="relative">
          {/* Outer ring */}
          <div className="h-16 w-16 animate-spin-slow rounded-full border-4 border-white/30 motion-reduce:animate-none!"
               style={{ animationDuration: '3s' }}>
            {/* Sprocket holes */}
            <div className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" />
            <div className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-white/40" />
            <div className="absolute left-0 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" />
            <div className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-white/40" />
          </div>
          {/* Inner circle */}
          <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20" />
        </div>

        {text ? (
          <p className="text-lg text-white/90">{text}</p>
        ) : (
          // A frozen reel alone would look hung, so Reduce Motion shows the label
          <p className="sr-only text-lg text-white/90 motion-reduce:not-sr-only">Loading...</p>
        )}
      </div>
    </div>
  )
}
