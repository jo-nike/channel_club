interface NoirFilterProps {
  isActive: boolean
}

/**
 * Noir filter overlay - classic black & white with high contrast.
 * Features desaturation, contrast boost, and dramatic vignette.
 */
export function NoirFilter({ isActive }: NoirFilterProps) {
  if (!isActive) return null

  return (
    <div
      className="noir-filter pointer-events-none absolute inset-0 z-10"
      role="presentation"
      aria-hidden="true"
    >
      {/* Desaturation layer using mix-blend-mode */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: '#808080',
          mixBlendMode: 'saturation',
        }}
      />

      {/* Contrast boost - darken shadows */}
      <div
        className="absolute inset-0 mix-blend-multiply opacity-20"
        style={{ backgroundColor: '#000000' }}
      />

      {/* Contrast boost - brighten highlights */}
      <div
        className="absolute inset-0 mix-blend-screen opacity-10"
        style={{ backgroundColor: '#ffffff' }}
      />

      {/* Dramatic vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 0.6) 100%)',
        }}
      />

      {/* Subtle film grain for texture */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.04]"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter id="noir-grain" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="1.2"
              numOctaves="4"
              seed={42}
              result="grain"
            />
            <feColorMatrix type="saturate" values="0" in="grain" result="mono" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#noir-grain)" />
      </svg>
    </div>
  )
}
