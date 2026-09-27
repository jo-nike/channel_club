import { useState, useCallback, useEffect, useRef } from 'react'

interface UseResizableOptions {
  initialHeightPercent: number
  minHeightPercent: number
  maxHeightPercent: number
  containerRef: React.RefObject<HTMLElement | null>
  onHeightChange?: (percent: number) => void
}

interface UseResizableResult {
  heightPercent: number
  isDragging: boolean
  handlePointerDown: (e: React.PointerEvent) => void
  handleKeyDown: (e: React.KeyboardEvent) => void
}

// How far one arrow key press moves the splitter
const KEY_STEP_PERCENT = 5

export function useResizable({
  initialHeightPercent,
  minHeightPercent,
  maxHeightPercent,
  containerRef,
  onHeightChange,
}: UseResizableOptions): UseResizableResult {
  const [heightPercent, setHeightPercent] = useState(initialHeightPercent)
  const [isDragging, setIsDragging] = useState(false)
  const startY = useRef(0)
  const startHeight = useRef(0)
  // The pointer that started the drag; a second finger doesn't move the splitter
  const pointerId = useRef<number | null>(null)

  // Pointer events cover mouse, touch and pen. Capturing the pointer keeps
  // the moves coming to the handle when the finger or cursor leaves it.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      pointerId.current = e.pointerId
      setIsDragging(true)
      startY.current = e.clientY
      startHeight.current = heightPercent
    },
    [heightPercent]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let newPercent: number
      switch (e.key) {
        case 'ArrowUp':
          newPercent = heightPercent + KEY_STEP_PERCENT
          break
        case 'ArrowDown':
          newPercent = heightPercent - KEY_STEP_PERCENT
          break
        case 'Home':
          newPercent = minHeightPercent
          break
        case 'End':
          newPercent = maxHeightPercent
          break
        default:
          return
      }
      e.preventDefault()
      newPercent = Math.min(maxHeightPercent, Math.max(minHeightPercent, newPercent))
      setHeightPercent(newPercent)
      onHeightChange?.(newPercent)
    },
    [heightPercent, minHeightPercent, maxHeightPercent, onHeightChange]
  )

  useEffect(() => {
    if (!isDragging) return

    const container = containerRef.current
    if (!container) return

    const containerHeight = container.clientHeight

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId.current) return
      // Dragging up (negative deltaY) increases EPG height
      const deltaY = startY.current - e.clientY
      const deltaPercent = (deltaY / containerHeight) * 100
      const newPercent = Math.min(
        maxHeightPercent,
        Math.max(minHeightPercent, startHeight.current + deltaPercent)
      )
      setHeightPercent(newPercent)
      onHeightChange?.(newPercent)
    }

    // Up ends the drag; cancel (the browser took the touch, say) ends it too
    const handlePointerEnd = (e: PointerEvent) => {
      if (e.pointerId !== pointerId.current) return
      pointerId.current = null
      setIsDragging(false)
    }

    // Captured events still bubble to the document
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerEnd)
    document.addEventListener('pointercancel', handlePointerEnd)

    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerEnd)
      document.removeEventListener('pointercancel', handlePointerEnd)
    }
  }, [isDragging, containerRef, minHeightPercent, maxHeightPercent, onHeightChange])

  // Sync with external height changes
  useEffect(() => {
    setHeightPercent(initialHeightPercent)
  }, [initialHeightPercent])

  return {
    heightPercent,
    isDragging,
    handlePointerDown,
    handleKeyDown,
  }
}
