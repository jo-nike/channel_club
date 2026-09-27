import { useLayoutEffect, useState, type RefObject } from 'react'

/** The part of a scroller's content in view: its scroll offsets and client size, px. */
export interface ScrollViewport {
  scrollLeft: number
  scrollTop: number
  width: number
  height: number
}

// Before the scroller is measured: no scroll, and no bigger than the window.
// An over-estimate only renders a little more on the first frame.
function estimate(): ScrollViewport {
  return { scrollLeft: 0, scrollTop: 0, width: window.innerWidth, height: window.innerHeight }
}

function read(element: HTMLElement): ScrollViewport {
  return {
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    width: element.clientWidth,
    height: element.clientHeight,
  }
}

function same(a: ScrollViewport, b: ScrollViewport): boolean {
  return a.scrollLeft === b.scrollLeft && a.scrollTop === b.scrollTop && a.width === b.width && a.height === b.height
}

/**
 * Tracks what's in view of the scroller in `ref`, for rendering only the
 * content near it. Measured before the first paint, then at most once an
 * animation frame while it scrolls or resizes, so a fast scroll costs one
 * render a frame rather than one an event. `enabled` is false while the
 * scroller isn't mounted (it re-attaches when that changes).
 */
export function useScrollViewport(ref: RefObject<HTMLElement | null>, enabled = true): ScrollViewport {
  const [viewport, setViewport] = useState(estimate)

  useLayoutEffect(() => {
    const element = ref.current
    if (!enabled || !element) return

    const update = () => {
      const next = read(element)
      setViewport((current) => (same(current, next) ? current : next))
    }

    let frame = 0
    const scheduleUpdate = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        update()
      })
    }

    update()
    element.addEventListener('scroll', scheduleUpdate, { passive: true })
    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('scroll', scheduleUpdate)
      observer.disconnect()
    }
  }, [ref, enabled])

  return viewport
}
