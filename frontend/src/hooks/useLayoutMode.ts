import { useMediaQuery } from '@/hooks/useMediaQuery'

export type LayoutMode = 'phone' | 'tablet' | 'desktop'

// Phones include exactly 768px, so the view and chat never disagree at the edge
export const PHONE_QUERY = '(max-width: 768px)'
export const DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * The one phone/tablet/desktop classifier for the app. Components ask this
 * instead of measuring the window themselves, so every part of the layout
 * switches at the same widths:
 * - phone: up to 768px wide
 * - tablet: 769px to 1023px
 * - desktop: 1024px and wider
 */
export function useLayoutMode(): LayoutMode {
  const isPhone = useMediaQuery(PHONE_QUERY)
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  if (isPhone) return 'phone'
  return isDesktop ? 'desktop' : 'tablet'
}
