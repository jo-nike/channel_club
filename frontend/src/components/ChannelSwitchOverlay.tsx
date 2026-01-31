import { useEffect, useState, useRef } from 'react'
import { ProjectorBeamLoader } from '@/components/ProjectorBeamLoader'
import { StaticNoiseOverlay } from '@/components/StaticNoiseOverlay'
import { ChannelInfoOverlay } from '@/components/ChannelInfoOverlay'

// Timing constants - exported for testing
export const STATIC_BURST_DURATION = 200 // ms (within AC spec of 150-300ms)
export const MIN_OVERLAY_DISPLAY = 2000 // ms
export const FADE_OUT_DURATION = 1000 // ms
export const ERROR_STATIC_DURATION = 800 // ms - extended static on error per AC #4

type Phase = 'STATIC_BURST' | 'LOADING' | 'FADE_OUT' | 'HIDDEN' | 'ERROR_STATIC'

interface ChannelSwitchOverlayProps {
  channelName: string
  isVisible: boolean
  /** Channel number (0 for Live, 1+ for ErsatzTV, or UUID slice for fallback) */
  channelNumber?: string | number
  /** Whether stream failed to load - triggers extended static per AC #4 */
  isError?: boolean
}

export function ChannelSwitchOverlay({
  channelName,
  isVisible,
  channelNumber = '00',
  isError = false,
}: ChannelSwitchOverlayProps) {
  const [phase, setPhase] = useState<Phase>('HIDDEN')
  const startTimeRef = useRef<number>(0)
  const phaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear phase timeout
  const clearPhaseTimeout = () => {
    if (phaseTimeoutRef.current) {
      clearTimeout(phaseTimeoutRef.current)
      phaseTimeoutRef.current = null
    }
  }

  // Clear error timeout
  const clearErrorTimeout = () => {
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current)
      errorTimeoutRef.current = null
    }
  }

  // Handle error state - AC #4: show extended static before error message
  // Uses separate timeout ref to avoid interfering with phase transitions
  useEffect(() => {
    if (isError && phase !== 'ERROR_STATIC' && phase !== 'HIDDEN') {
      clearPhaseTimeout() // Stop any pending phase transition
      clearErrorTimeout()
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase('ERROR_STATIC')

      // After extended static, hide overlay so error message can show
      errorTimeoutRef.current = setTimeout(() => {
        setPhase('HIDDEN')
      }, ERROR_STATIC_DURATION)
    }

    return clearErrorTimeout
  }, [isError]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle visibility changes - start state machine
  // Note: setState is intentional here to sync component phase with external isVisible prop
  useEffect(() => {
    if (isVisible) {
      // Reset to start of state machine
      clearPhaseTimeout()
      clearErrorTimeout()
      startTimeRef.current = Date.now()
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase('STATIC_BURST')

      // Transition to LOADING after static burst
      phaseTimeoutRef.current = setTimeout(() => {
        setPhase('LOADING')
      }, STATIC_BURST_DURATION)
    } else if (phase !== 'HIDDEN' && phase !== 'ERROR_STATIC') {
      // Stream started playing - check minimum display time
      const elapsed = Date.now() - startTimeRef.current
      const remaining = MIN_OVERLAY_DISPLAY - elapsed

      clearPhaseTimeout()

      if (remaining > 0) {
        // Wait for minimum display time before fading out
        phaseTimeoutRef.current = setTimeout(() => {
          setPhase('FADE_OUT')
          // Hide after fade-out animation completes
          phaseTimeoutRef.current = setTimeout(() => {
            setPhase('HIDDEN')
          }, FADE_OUT_DURATION)
        }, remaining)
      } else {
        // Already past minimum time, start fade out
        setPhase('FADE_OUT')
        phaseTimeoutRef.current = setTimeout(() => {
          setPhase('HIDDEN')
        }, FADE_OUT_DURATION)
      }
    }

    return clearPhaseTimeout
  }, [isVisible]) // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render if hidden
  if (phase === 'HIDDEN') return null

  // Determine fade state for channel info
  const fadeState: 'in' | 'out' | 'none' =
    phase === 'STATIC_BURST' || phase === 'ERROR_STATIC'
      ? 'in'
      : phase === 'FADE_OUT'
        ? 'out'
        : 'none'

  // Show static during STATIC_BURST or ERROR_STATIC phases
  const showStatic = phase === 'STATIC_BURST' || phase === 'ERROR_STATIC'

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* Static noise burst - during STATIC_BURST or ERROR_STATIC phases */}
      <StaticNoiseOverlay isVisible={showStatic} />

      {/* Projector beam loader - during LOADING phase only */}
      {phase === 'LOADING' && <ProjectorBeamLoader text={`Loading ${channelName}...`} />}

      {/* Channel info overlay - visible during all phases with appropriate fade */}
      <ChannelInfoOverlay
        channelNumber={channelNumber}
        channelName={channelName}
        fadeState={fadeState}
      />

      {/* Fade out overlay background during FADE_OUT phase */}
      {phase === 'FADE_OUT' && (
        <div className="absolute inset-0 bg-black/70 animate-overlay-fade-out" />
      )}
    </div>
  )
}
