const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** Whether the OS "reduce motion" setting is on. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/**
 * The behavior for scrollTo/scrollBy/scrollIntoView: 'smooth', or 'auto' (a
 * jump) under reduce motion. A JS 'smooth' ignores the CSS scroll-behavior
 * override in index.css, so smooth scrolls from code must ask here.
 */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}
