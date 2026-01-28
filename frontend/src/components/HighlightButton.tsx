import { useCallback } from 'react'
import { Clapperboard } from 'lucide-react'
import { type HighlightStatusResponse } from '@/services/api'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface HighlightButtonProps {
  channelId: string
  isVisible: boolean
  highlightStatus: HighlightStatusResponse
  onOpenModal?: () => void
}

export function HighlightButton({ channelId: _channelId, isVisible, highlightStatus, onOpenModal }: HighlightButtonProps) {
  const handleClick = useCallback(() => {
    if (onOpenModal) {
      onOpenModal()
    }
  }, [onOpenModal])

  // Hide button if not recording
  if (!highlightStatus.recording) {
    return null
  }

  const seconds = Math.round(highlightStatus.bufferSeconds || 0)
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
          <Clapperboard className="h-6 w-6 text-white" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}
