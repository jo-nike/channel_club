import { useEffect, useState, useRef } from 'react'
import { ProjectorBeamLoader } from '@/components/ProjectorBeamLoader'
import { StaticNoiseOverlay } from '@/components/StaticNoiseOverlay'
import { ChannelInfoOverlay } from '@/components/ChannelInfoOverlay'
import { VHSTrackingEffect } from '@/components/filters/VHSTrackingEffect'
import { FilmCountdownOverlay } from '@/components/filters/FilmCountdownOverlay'
import { NoirIrisOverlay } from '@/components/filters/NoirIrisOverlay'
import { GrindhouseTransitionOverlay } from '@/components/filters/GrindhouseTransitionOverlay'
import { useFilterStore } from '@/stores/filterStore'

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

  // Filter states
  const isRetroTVActive = useFilterStore((s) => s.isFilterActive('retro-tv'))
  const isFilmGrainActive = useFilterStore((s) => s.isFilterActive('film-grain'))
  const isNoirActive = useFilterStore((s) => s.isFilterActive('noir'))
  const isGrindhouseActive = useFilterStore((s) => s.isFilterActive('grindhouse'))

  // Determine which transition style to use (priority order)
  const getTransitionType = () => {
    if (isGrindhouseActive) return 'grindhouse'
    if (isNoirActive) return 'noir'
    if (isFilmGrainActive) return 'film-grain'
    if (isRetroTVActive) return 'retro-tv'
    return 'default'
  }

  const transitionType = getTransitionType()

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
  useEffect(() => {
    if (isError && phase !== 'ERROR_STATIC' && phase !== 'HIDDEN') {
      clearPhaseTimeout()
      clearErrorTimeout()
      setPhase('ERROR_STATIC')

      errorTimeoutRef.current = setTimeout(() => {
        setPhase('HIDDEN')
      }, ERROR_STATIC_DURATION)
    }

    return clearErrorTimeout
  }, [isError]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle visibility changes - start state machine
  useEffect(() => {
    if (isVisible) {
      clearPhaseTimeout()
      clearErrorTimeout()
      startTimeRef.current = Date.now()
      setPhase('STATIC_BURST')

      // Transition to LOADING after static burst
      phaseTimeoutRef.current = setTimeout(() => {
        setPhase('LOADING')
      }, STATIC_BURST_DURATION)
    } else if (phase !== 'HIDDEN' && phase !== 'ERROR_STATIC') {
      const elapsed = Date.now() - startTimeRef.current
      const remaining = MIN_OVERLAY_DISPLAY - elapsed

      clearPhaseTimeout()

      if (remaining > 0) {
        phaseTimeoutRef.current = setTimeout(() => {
          setPhase('FADE_OUT')
          phaseTimeoutRef.current = setTimeout(() => {
            setPhase('HIDDEN')
          }, FADE_OUT_DURATION)
        }, remaining)
      } else {
        setPhase('FADE_OUT')
        phaseTimeoutRef.current = setTimeout(() => {
          setPhase('HIDDEN')
        }, FADE_OUT_DURATION)
      }
    }

    return clearPhaseTimeout
  }, [isVisible]) // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'HIDDEN') return null

  // Determine fade state for channel info
  const fadeState: 'in' | 'out' | 'none' =
    phase === 'STATIC_BURST' || phase === 'ERROR_STATIC'
      ? 'in'
      : phase === 'FADE_OUT'
        ? 'out'
        : 'none'

  const showStatic = phase === 'STATIC_BURST' || phase === 'ERROR_STATIC'
  const isLoading = phase === 'STATIC_BURST' || phase === 'LOADING' || phase === 'ERROR_STATIC'

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* Default: Static noise burst - only for default and retro-tv */}
      {(transitionType === 'default' || transitionType === 'retro-tv') && (
        <StaticNoiseOverlay isVisible={showStatic} />
      )}

      {/* Retro TV: VHS tracking effects */}
      {transitionType === 'retro-tv' && (
        <VHSTrackingEffect isActive={isLoading} />
      )}

      {/* Film Grain: Film countdown leader */}
      {transitionType === 'film-grain' && (
        <FilmCountdownOverlay isActive={isLoading} />
      )}

      {/* Noir: Iris wipe */}
      {transitionType === 'noir' && (
        <NoirIrisOverlay isActive={isLoading} />
      )}

      {/* Grindhouse: Damaged film reel */}
      {transitionType === 'grindhouse' && (
        <GrindhouseTransitionOverlay isActive={isLoading} />
      )}

      {/* Default: Projector beam loader - only when no filter active */}
      {transitionType === 'default' && phase === 'LOADING' && (
        <ProjectorBeamLoader text={`Loading ${channelName}...`} />
      )}

      {/* Channel info overlay - visible during all phases with appropriate fade */}
      {/* Hide for film-grain and grindhouse which have their own text */}
      {transitionType !== 'film-grain' && transitionType !== 'grindhouse' && (
        <ChannelInfoOverlay
          channelNumber={channelNumber}
          channelName={channelName}
          fadeState={fadeState}
        />
      )}

      {/* Fade out overlay background during FADE_OUT phase */}
      {phase === 'FADE_OUT' && (
        <div className="absolute inset-0 bg-black/70 animate-overlay-fade-out" />
      )}
    </div>
  )
}
