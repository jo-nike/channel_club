import { useMediaQuery } from '@/hooks/useMediaQuery'

/**
 * A touch phone held sideways. Detected by height rather than width: phones
 * in landscape are 932-956px wide on the Plus/Pro Max class, wider than any
 * sensible width cut-off, but none is taller than 500px. Tablets in landscape
 * (768px tall and up) stay out.
 */
const MOBILE_LANDSCAPE_QUERY = '(pointer: coarse) and (orientation: landscape) and (max-height: 500px)'

/**
 * Hook that detects when a phone is in landscape orientation.
 * Used to trigger CSS-based pseudo-fullscreen for video players.
 */
export function useMobileLandscape(): boolean {
  return useMediaQuery(MOBILE_LANDSCAPE_QUERY)
}
