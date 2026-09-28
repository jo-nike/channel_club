import { useCallback, useEffect, useState } from 'react'
import { Cast } from 'lucide-react'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useChromecast } from '@/hooks/useChromecast'
import { getFullscreenElement } from '@/hooks/useFullscreenState'
import { cn } from '@/lib/utils'
import { useCastStore } from '@/stores/castStore'
import { LIVE_CHANNEL_ID, useTVStore } from '@/stores/tvStore'

export interface CastButtonProps {
  /** Channel ID for creating cast sessions */
  channelId: string
  /** Stream type: 'hls' for ErsatzTV, 'mpegts' for live channels */
  streamType: 'hls' | 'mpegts'
  /** Stream URL (optional - will be resolved by backend if not provided) */
  streamUrl?: string
  /** Channel name for Chromecast display */
  channelName?: string
  /** Whether the button should be visible/focusable */
  isVisible: boolean
}

/**
 * Cast button for Chromecast streaming.
 *
 * Shows a cast icon that:
 * - Is hidden when Cast SDK is not available or feature is disabled
 * - Shows device picker when clicked (if not connected)
 * - Starts casting when clicked (if connected but not casting)
 * - Shows stop option when casting
 *
 * The button color indicates state:
 * - White: Available but not connected
 * - Blue: Connected or casting
 *
 * A cast failure shows as a toast. Toasts are drawn outside the player, so
 * none shows while anything is fullscreen: the player shows those as a banner.
 */
export function CastButton({
  channelId,
  streamType,
  streamUrl,
  channelName,
  isVisible,
}: CastButtonProps) {
  const {
    isAvailable,
    isConnected,
    isCasting,
    deviceName,
    isLoading,
    startCasting,
    stopCasting,
    requestSession,
  } = useChromecast()

  const [isStarting, setIsStarting] = useState(false)
  // A cast from the Live slot follows Live (the server moves it and stops it)
  const followsLive = useTVStore((s) => s.selectedChannel?.id === LIVE_CHANNEL_ID)

  // Only failures that happen from now on: each report is a new object
  useEffect(
    () =>
      useCastStore.subscribe((state, prev) => {
        if (state.lastError && state.lastError !== prev.lastError && !getFullscreenElement()) {
          toast.error(state.lastError.message)
        }
      }),
    []
  )

  const handleClick = useCallback(async () => {
    if (isStarting) return

    if (isCasting) {
      // Already casting - stop
      await stopCasting()
      return
    }

    if (!isConnected) {
      // Not connected - open device picker with cast params for auto-cast on connect
      requestSession({ channelId, streamType, streamUrl, title: channelName, followsLive })
      return
    }

    // Connected but not casting - start casting
    setIsStarting(true)
    try {
      await startCasting(channelId, streamType, streamUrl, channelName, followsLive)
    } catch {
      // Error is already logged and set in state by hook
    } finally {
      setIsStarting(false)
    }
  }, [
    isStarting,
    isConnected,
    isCasting,
    requestSession,
    stopCasting,
    startCasting,
    channelId,
    streamType,
    streamUrl,
    channelName,
    followsLive,
  ])

  // Hide button while loading or if cast is not available
  // Only show once we confirm cast is available
  if (isLoading || !isAvailable) {
    return null
  }

  // Build tooltip text based on state
  let tooltipText: string
  if (isCasting && deviceName) {
    tooltipText = `Casting to ${deviceName} · click to stop`
  } else if (isConnected && deviceName) {
    tooltipText = `Connected to ${deviceName} · click to cast`
  } else if (isStarting) {
    tooltipText = 'Starting cast...'
  } else {
    tooltipText = 'Cast to Chromecast'
  }

  // Icon color based on state
  const isActive = isConnected || isCasting

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={isVisible ? 0 : -1}
          onClick={handleClick}
          disabled={isStarting}
          aria-label={tooltipText}
          className={cn(
            'control-button relative flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-ring-media',
            isStarting && 'opacity-50 cursor-wait'
          )}
        >
          <Cast
            className={cn(
              'h-6 w-6 transition-colors',
              isActive ? 'text-blue-400' : 'text-white'
            )}
          />
          {/* Show a small dot indicator when casting */}
          {isCasting && (
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}
