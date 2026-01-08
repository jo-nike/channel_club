import { useState, useEffect, useCallback } from 'react'
import { Download } from 'lucide-react'
import { getHighlightStatus } from '@/services/api'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface HighlightButtonProps {
  channelId: string
  isVisible: boolean
  onOpenModal?: () => void
}

export function HighlightButton({ channelId, isVisible, onOpenModal }: HighlightButtonProps) {
  const [bufferSeconds, setBufferSeconds] = useState(0)
  const [isRecording, setIsRecording] = useState(false)

  // Poll for buffer status every 5 seconds when visible
  useEffect(() => {
    if (!isVisible || !channelId) return

    const fetchStatus = async () => {
      try {
        const status = await getHighlightStatus(channelId)
        setIsRecording(status.recording)
        setBufferSeconds(status.bufferSeconds)
      } catch {
        // Silently fail - status is informational
      }
    }

    // Initial fetch
    fetchStatus()

    // Poll every 5 seconds
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [channelId, isVisible])

  const handleClick = useCallback(() => {
    if (onOpenModal) {
      onOpenModal()
    }
  }, [onOpenModal])

  // Hide button if not recording (instead of showing disabled)
  if (!isRecording) {
    return null
  }

  // Build tooltip text
  const seconds = Math.round(bufferSeconds || 0)
  const tooltipText = `Save last ${seconds}s`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          onClick={handleClick}
          aria-label={tooltipText}
          className="control-button relative flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
        >
          <Download className="h-6 w-6 text-white" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}
