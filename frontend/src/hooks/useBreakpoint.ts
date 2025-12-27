import { useState, useEffect } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

/**
 * Breakpoint definitions for responsive layouts:
 * - mobile: < 768px
 * - tablet: 768px - 1023px
 * - desktop: >= 1024px
 *
 * These match Tailwind's md (768px) and lg (1024px) breakpoints.
 */
export const BREAKPOINTS = {
  MOBILE_MAX: 767,
  TABLET_MIN: 768,
  TABLET_MAX: 1023,
  DESKTOP_MIN: 1024,
} as const

/**
 * Custom hook to detect the current responsive breakpoint.
 * Updates automatically when the window is resized.
 *
 * @returns The current breakpoint: 'mobile', 'tablet', or 'desktop'
 *
 * @example
 * const breakpoint = useBreakpoint()
 * const isMobile = breakpoint === 'mobile'
 * const isTabletOrSmaller = breakpoint !== 'desktop'
 */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => getBreakpoint())

  useEffect(() => {
    const handleResize = () => {
      setBreakpoint(getBreakpoint())
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return breakpoint
}

function getBreakpoint(): Breakpoint {
  const width = window.innerWidth
  if (width < BREAKPOINTS.TABLET_MIN) return 'mobile'
  if (width < BREAKPOINTS.DESKTOP_MIN) return 'tablet'
  return 'desktop'
}
