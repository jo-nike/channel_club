interface SportsHDFilterProps {
  isActive: boolean
}

/**
 * Sports HD filter - enhances clarity for fast-action sports viewing.
 * Optimized for ice hockey: improves puck visibility, reduces ice glare,
 * and enhances jersey colors.
 *
 * Features:
 * - Contrast boost (1.15) - puck/players stand out from ice
 * - Saturation boost (1.1) - jersey colors pop
 * - Brightness reduction (0.95) - reduces ice glare
 * - Subtle sharpening - improves edge definition
 */
export function SportsHDFilter({ isActive }: SportsHDFilterProps) {
  if (!isActive) return null

  return (
    <div
      className="sports-hd-filter pointer-events-none absolute inset-0 z-10"
      role="presentation"
      aria-hidden="true"
    >
      {/* SVG filter for sharpening */}
      <svg className="absolute h-0 w-0" aria-hidden="true">
        <defs>
          <filter id="sports-sharpen" x="0%" y="0%" width="100%" height="100%">
            {/* Unsharp mask sharpening - subtle edge enhancement */}
            <feConvolveMatrix
              order="3"
              kernelMatrix="0 -0.5 0 -0.5 3 -0.5 0 -0.5 0"
              preserveAlpha="true"
            />
          </filter>
        </defs>
      </svg>

      {/* Main enhancement layer using backdrop-filter */}
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: 'contrast(1.15) saturate(1.1) brightness(0.95)',
          WebkitBackdropFilter: 'contrast(1.15) saturate(1.1) brightness(0.95)',
        }}
      />

      {/* Sharpening overlay - applies SVG filter to create edge enhancement effect */}
      <div
        className="absolute inset-0 mix-blend-overlay opacity-[0.15]"
        style={{
          backdropFilter: 'url(#sports-sharpen)',
          WebkitBackdropFilter: 'url(#sports-sharpen)',
        }}
      />

      {/* Subtle vignette to focus attention on center action */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 70%, rgba(0, 0, 0, 0.15) 100%)',
        }}
      />
    </div>
  )
}
