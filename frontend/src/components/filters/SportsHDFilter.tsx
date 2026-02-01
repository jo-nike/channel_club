interface SportsHDFilterProps {
  isActive: boolean
}

/**
 * Sports HD filter - enhances clarity for fast-action sports viewing.
 * Optimized for ice hockey: improves puck visibility, reduces ice glare,
 * and enhances jersey colors.
 */
export function SportsHDFilter({ isActive }: SportsHDFilterProps) {
  if (!isActive) return null

  return (
    <div
      className="sports-hd-filter pointer-events-none absolute inset-0 z-10"
      role="presentation"
      aria-hidden="true"
    >
      {/* Main enhancement layer using backdrop-filter */}
      <div
        className="absolute inset-0"
        style={{
          // Stronger values for visible effect:
          // - contrast 1.2: makes darks darker, lights lighter (puck pops)
          // - saturate 1.25: vivid jersey colors
          // - brightness 0.92: reduces ice glare
          backdropFilter: 'contrast(1.2) saturate(1.25) brightness(0.92)',
          WebkitBackdropFilter: 'contrast(1.2) saturate(1.25) brightness(0.92)',
        }}
      />

      {/* Subtle vignette to focus attention on center action */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0, 0, 0, 0.2) 100%)',
        }}
      />
    </div>
  )
}
