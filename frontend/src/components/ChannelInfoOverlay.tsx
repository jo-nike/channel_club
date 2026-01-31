interface ChannelInfoOverlayProps {
  /** Channel number to display (0 for Live TV, 1+ for ErsatzTV) */
  channelNumber: string | number
  /** Channel name to display */
  channelName: string
  /** Current fade state for animation */
  fadeState: 'in' | 'out' | 'none'
}

/**
 * Retro TV-style channel info overlay with phosphor glow effect.
 * Displays channel number and name in bottom-left corner.
 */
export function ChannelInfoOverlay({
  channelNumber,
  channelName,
  fadeState,
}: ChannelInfoOverlayProps) {
  // Format channel number with leading zeros for retro look
  const formattedNumber =
    typeof channelNumber === 'number'
      ? channelNumber.toString().padStart(2, '0')
      : channelNumber.padStart(2, '0')

  const fadeClass =
    fadeState === 'in'
      ? 'animate-overlay-fade-in'
      : fadeState === 'out'
        ? 'animate-overlay-fade-out'
        : ''

  return (
    <div
      className={`pointer-events-none absolute bottom-8 left-8 z-20 will-change-opacity ${fadeClass}`}
    >
      {/* Channel number - large retro style */}
      <div className="text-phosphor-glow animate-phosphor-glow-pulse text-6xl font-bold">
        {formattedNumber}
      </div>

      {/* Channel name - smaller below number */}
      <div className="text-phosphor-glow mt-1 text-xl font-medium tracking-wider">
        {channelName}
      </div>
    </div>
  )
}
