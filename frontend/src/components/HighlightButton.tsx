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

export function HighlightButton({ isVisible, highlightStatus, onOpenModal }: HighlightButtonProps) {
  const handleClick = useCallback(() => {
    if (onOpenModal) {
      onOpenModal()
    }
  }, [onOpenModal])

  const seconds = Math.max(0, Math.floor(highlightStatus.bufferSeconds || 0))
  const ready = highlightStatus.recording && (highlightStatus.ready ?? seconds > 0)
  const tooltipText = ready ? `Capture clip · ${seconds}s available`
    : highlightStatus.recording ? 'Buffering clip…' : 'Clip unavailable'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          onClick={handleClick}
          disabled={!ready}
          aria-label={tooltipText}
          className="control-button relative flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-lg px-2 transition-colors disabled:opacity-50 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/80"
        >
          <Clapperboard className="h-6 w-6 text-white" />
          <span className="hidden text-xs text-white sm:inline">{ready ? `Capture clip · ${seconds}s` : tooltipText}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}
