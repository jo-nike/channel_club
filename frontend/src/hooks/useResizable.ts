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
  handleMouseDown: (e: React.MouseEvent) => void
}

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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(true)
      startY.current = e.clientY
      startHeight.current = heightPercent
    },
    [heightPercent]
  )

  useEffect(() => {
    if (!isDragging) return

    const container = containerRef.current
    if (!container) return

    const containerHeight = container.clientHeight

    const handleMouseMove = (e: MouseEvent) => {
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

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, containerRef, minHeightPercent, maxHeightPercent, onHeightChange])

  // Sync with external height changes
  useEffect(() => {
    setHeightPercent(initialHeightPercent)
  }, [initialHeightPercent])

  return {
    heightPercent,
    isDragging,
    handleMouseDown,
  }
}
