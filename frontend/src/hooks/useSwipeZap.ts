import { useEffect, useRef, type RefObject } from 'react'

// How far a finger must travel up or down to change channel. Anything
// shorter changes nothing here: a tap (within useAutoHide's 10px slop) still
// shows or hides the controls, and a swipe past that slop does neither.
const SWIPE_MIN_PX = 60
// A swipe must start in the middle 60% of the player's height: the top and
// bottom 20% belong to the system (the notification shade and Control Center
// from the top, the home indicator and Safari's toolbar from the bottom)
const EDGE_BAND = 0.2

interface UseSwipeZapOptions {
  /** The element the finger moves over (the player shell) */
  containerRef: RefObject<HTMLElement | null>
  /** Only while this is true: a phone held sideways */
  enabled: boolean
  /** The page's zap: +1 is channel up, -1 channel down */
  onStep?: (dir: 1 | -1) => void
}

/**
 * Vertical swipes on the picture change channel, like flicking through a
 * feed: up for the next channel, down for the previous one. Each swipe goes
 * through the page's zap, so the banner follows at once and the tune waits
 * for the swipes to stop. The swipe is judged when the finger lifts: it must
 * travel over 60px, more up or down than sideways, and start clear of the
 * top and bottom edges. Mouse pointers, a second finger, and swipes that
 * start on the controls or in a dialog in the shell change nothing.
 *
 * The container needs touch-action: none while this is on, or the browser
 * takes the gesture for scrolling and cancels the pointer.
 */
export function useSwipeZap({ containerRef, enabled, onStep }: UseSwipeZapOptions): void {
  const onStepRef = useRef(onStep)
  useEffect(() => {
    onStepRef.current = onStep
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) return

    let start: { id: number; x: number; y: number } | null = null
    // Set when a second finger lands (a pinch), until every finger lifts
    let multiTouch = false
    let activePointers = 0

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      // A primary pointer means no other finger is down. Start the count
      // afresh, so a lift that never reached the shell (its target was
      // removed mid-gesture, or the system took the touch without a
      // pointercancel) can't leave every later swipe looking like a pinch.
      if (e.isPrimary) {
        activePointers = 0
        multiTouch = false
        start = null
      }
      activePointers += 1
      if (activePointers > 1) {
        multiTouch = true
        start = null
        return
      }
      if (e.target instanceof Element && e.target.closest('.video-controls, [role="dialog"]')) return

      const rect = container.getBoundingClientRect()
      const offset = e.clientY - rect.top
      if (offset < rect.height * EDGE_BAND || offset > rect.height * (1 - EDGE_BAND)) return

      start = { id: e.pointerId, x: e.clientX, y: e.clientY }
    }

    const endPointer = () => {
      activePointers = Math.max(0, activePointers - 1)
      if (activePointers === 0) multiTouch = false
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      const began = start
      const wasMultiTouch = multiTouch
      if (began?.id === e.pointerId) start = null
      endPointer()
      if (!began || began.id !== e.pointerId || wasMultiTouch) return

      const dx = e.clientX - began.x
      const dy = e.clientY - began.y
      if (Math.abs(dy) <= SWIPE_MIN_PX || Math.abs(dy) <= Math.abs(dx)) return

      // Up the screen (y falling) is the next channel
      onStepRef.current?.(dy < 0 ? 1 : -1)
    }

    const handlePointerCancel = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      if (start?.id === e.pointerId) start = null
      endPointer()
    }

    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('pointerup', handlePointerUp)
    container.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('pointerup', handlePointerUp)
      container.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [containerRef, enabled])
}
