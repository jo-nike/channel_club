interface NoirFilterProps {
  isActive: boolean
}

/**
 * Noir filter overlay - classic black & white with high contrast.
 * Uses backdrop-filter for proper desaturation without affecting UI controls.
 */
export function NoirFilter({ isActive }: NoirFilterProps) {
  if (!isActive) return null

  return (
    <div
      className="noir-filter pointer-events-none absolute inset-0 z-10"
      role="presentation"
      aria-hidden="true"
    >
      {/* Desaturation + contrast using backdrop-filter */}
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: 'grayscale(1) contrast(1.15)',
          WebkitBackdropFilter: 'grayscale(1) contrast(1.15)',
        }}
      />

      {/* Dramatic vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0, 0, 0, 0.6) 100%)',
        }}
      />

      {/* Subtle film grain for texture */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.05]"
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
