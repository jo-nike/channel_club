import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useTVMode } from '@/hooks/useTVMode'

export type LayoutMode = 'phone' | 'tablet' | 'desktop'

// Phones include exactly 768px, so the view and chat never disagree at the edge
export const PHONE_QUERY = '(max-width: 768px)'
export const DESKTOP_QUERY = '(min-width: 1024px)'
// A touch tablet held upright (an 820px iPad): beside a 288px list its video
// would be about 530px wide, so it takes the phone's stacked layout instead
export const TOUCH_PORTRAIT_QUERY = '(pointer: coarse) and (orientation: portrait) and (max-width: 1023px)'
// A touch tablet held sideways, up to a 1366px iPad Pro. Taller than 500px,
// so a phone on its side (see useMobileLandscape) stays out.
export const TOUCH_TABLET_QUERY = '(pointer: coarse) and (orientation: landscape) and (min-height: 501px) and (max-width: 1366px)'

/**
 * A touch tablet held sideways, which gets the tablet layout at any width up
 * to 1366px. Not a TV: webOS pointer mode can report a coarse pointer.
 */
export function useTouchTablet(): boolean {
  const isTouchLandscape = useMediaQuery(TOUCH_TABLET_QUERY)
  const isTVMode = useTVMode()
  return isTouchLandscape && !isTVMode
}

/**
 * The one phone/tablet/desktop classifier for the app. Components ask this
 * instead of measuring the window themselves, so every part of the layout
 * switches at the same widths:
 * - phone: up to 768px wide, and touch screens in portrait below 1024px
 * - tablet: 769px to 1023px, and touch tablets held sideways up to 1366px
 * - desktop: 1024px and wider
 */
export function useLayoutMode(): LayoutMode {
  const isPhone = useMediaQuery(PHONE_QUERY)
  const isTouchPortrait = useMediaQuery(TOUCH_PORTRAIT_QUERY)
  const isTouchTablet = useTouchTablet()
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  if (isPhone || isTouchPortrait) return 'phone'
  return isDesktop && !isTouchTablet ? 'desktop' : 'tablet'
}
