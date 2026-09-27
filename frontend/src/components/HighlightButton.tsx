import { useCallback } from 'react'
import { Clapperboard, MessageSquareShare } from 'lucide-react'
import { type HighlightStatusResponse } from '@/services/api'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface HighlightButtonProps {
  isVisible: boolean
  highlightStatus: HighlightStatusResponse
  /** False until the first status poll answers: the status is a placeholder */
  loaded: boolean
  onOpenModal?: () => void
  /**
   * The phone-landscape bar: a 44px target, and no button at all while the
   * channel isn't recording, where the bar has no room for a control that
   * does nothing. Elsewhere an unavailable clip stays, disabled, with its tooltip.
   */
  compact?: boolean
  /**
   * The secondary action, 'Clip that': post the last 20s to chat in one
   * press. Absent where it isn't offered (no Zipline or chat, a TV).
   */
  onClipThat?: () => void
  /**
   * A Clip that is running. It holds the server's one capture for this user,
   * so neither action may capture again until it is done.
   */
  clipping?: boolean
  /** The clip editor is open, and owns the capture: no Clip that meanwhile */
  editing?: boolean
}

type ClipState = 'checking' | 'unavailable' | 'buffering' | 'ready'

// The ring around the icon, in a 40-unit box
const RING_RADIUS = 18
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * A fixed-width icon control: the ring shows how much of the clip buffer is
 * filled, and readiness and seconds go in the label and tooltip, never in
 * visible text, so a channel switch doesn't move the buttons beside it.
 */
export function HighlightButton({ isVisible, highlightStatus, loaded, onOpenModal, compact = false, onClipThat, clipping = false, editing = false }: HighlightButtonProps) {
  const handleClick = useCallback(() => {
    if (onOpenModal) {
      onOpenModal()
    }
  }, [onOpenModal])

  const seconds = Math.max(0, Math.floor(highlightStatus.bufferSeconds || 0))
  const maxSeconds = Math.max(0, Math.floor(highlightStatus.maxBufferSeconds || 0))
  const state: ClipState = !loaded ? 'checking'
    : !highlightStatus.recording ? 'unavailable'
      : (highlightStatus.ready ?? seconds > 0) ? 'ready' : 'buffering'
  const label = state === 'ready' ? `Capture clip · ${seconds}s available`
    : state === 'buffering' ? `Buffering clip · ${seconds}s of ${maxSeconds}s`
      : state === 'checking' ? 'Checking clip…' : 'Clip unavailable'
  const filled = maxSeconds > 0 ? Math.min(1, seconds / maxSeconds) : 0
  const clipThatLabel = clipping ? 'Clip that · posting…'
    : editing ? 'Clip that · close the clip editor first' : 'Clip that · post the last 20s to chat'

  if (compact && state === 'unavailable') return null

  // Fixed in each size, so a state change never moves the buttons beside it;
  // the 40px ring sits centred in either
  const size = compact ? 'h-11 min-h-[44px] w-11 min-w-[44px]' : 'h-12 min-h-[48px] w-12 min-w-[48px]'

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={isVisible ? 0 : -1}
            onClick={handleClick}
            disabled={state !== 'ready' || clipping}
            aria-label={label}
            data-state={state}
            className={`control-button relative flex ${size} shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50 hover:bg-white/10 focus-ring-media`}
          >
            <svg viewBox="0 0 40 40" aria-hidden="true" className={`pointer-events-none absolute ${compact ? 'inset-0.5' : 'inset-1'} h-10 w-10 -rotate-90`}>
              <circle cx="20" cy="20" r={RING_RADIUS} fill="none" strokeWidth="2.5" className="stroke-white/25" />
              {(state === 'buffering' || state === 'ready') && (
                <circle
                  data-ring="progress"
                  cx="20"
                  cy="20"
                  r={RING_RADIUS}
                  fill="none"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE * (1 - filled)}
                  className={state === 'ready' ? 'stroke-primary' : 'stroke-white'}
                />
              )}
            </svg>
            <Clapperboard className="h-5 w-5 text-white" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
      {onClipThat && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={isVisible ? 0 : -1}
              onClick={onClipThat}
              disabled={state !== 'ready' || clipping || editing}
              aria-label={clipThatLabel}
              className={`control-button flex ${size} shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50 hover:bg-white/10 focus-ring-media`}
            >
              <MessageSquareShare className="h-5 w-5 text-white" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{clipThatLabel}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
