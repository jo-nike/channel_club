import { useId, useMemo } from 'react'
import { Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { StreamRecoveryStatus } from '@/hooks/useStreamRecovery'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { buildUnifiedChannels, useTVStore } from '@/stores/tvStore'
import type { UnifiedChannel } from '@/types'

interface StreamStatusCardProps {
  /** The engine's recovery state; 'unsupported' when this browser can't play the stream at all */
  status: StreamRecoveryStatus | 'unsupported'
  /** The reconnect under way, 1-based */
  attempt: number
  maxAttempts: number
  /** Nothing has played on this channel yet: the tries are starting it, not reconnecting */
  isStarting?: boolean
  /** Start again with a full set of reconnects */
  onRetry: () => void
}

/**
 * What the player says when its stream fails, the same for every engine and
 * rendered inside the player shell (so it shows in fullscreen and theater):
 * - reconnecting: a small pill over the picture that lets taps through, so
 *   the controls stay usable while it tries again
 * - failed: 'Stream stopped' with Retry, and 'Back to' the channel this
 *   viewer was on before. That is only this viewer's pick: it never changes
 *   the club's live channel.
 */
export function StreamStatusCard({ status, attempt, maxAttempts, isStarting = false, onRetry }: StreamStatusCardProps) {
  const previous = usePreviousChannel()
  const selectChannel = useTVStore((s) => s.selectChannel)
  const titleId = useId()

  if (status === 'reconnecting') {
    return (
      <div
        role="status"
        className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/80 px-4 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur-md"
      >
        <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        <span className="tabular-nums">
          {`${isStarting ? 'Starting stream...' : 'Reconnecting...'} ${attempt} of ${maxAttempts}`}
        </span>
      </div>
    )
  }

  if (status !== 'failed' && status !== 'unsupported') return null

  const isUnsupported = status === 'unsupported'

  return (
    <>
      {/* Dims the picture under the card; the control bar paints above it */}
      <div className="pointer-events-none absolute inset-0 bg-black/70" aria-hidden="true" />
      {/* video-controls: a tap on the card uses it rather than toggling the controls */}
      <section
        aria-labelledby={titleId}
        className="video-controls absolute left-1/2 top-1/2 z-20 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/15 bg-black/85 px-5 py-4 text-center text-white shadow-xl backdrop-blur-md"
      >
        <div role="alert">
          <p id={titleId} className="font-display text-2xl font-extrabold tracking-wide">
            {isUnsupported ? "Can't play live TV here" : 'Stream stopped'}
          </p>
          <p className="mt-1 text-sm text-white/70">
            {isUnsupported
              ? "This browser can't play the live channel's stream."
              : `It didn't come back after ${maxAttempts} tries.`}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {!isUnsupported && (
            <Button onClick={onRetry} className="min-h-11 focus-ring-media">
              <RotateCw aria-hidden="true" />
              Retry
            </Button>
          )}
          {previous && (
            <Button
              variant="secondary"
              onClick={() => selectChannel(previous)}
              className="min-h-11 max-w-full focus-ring-media"
            >
              <span className="truncate">Back to {previous.name}</span>
            </Button>
          )}
        </div>
      </section>
    </>
  )
}

/**
 * The channel this viewer was on before, while it is still listed and has
 * something to play (the live slot with live TV stopped doesn't)
 */
function usePreviousChannel(): UnifiedChannel | null {
  const previousId = useTVStore((s) => s.previousChannelId)
  const liveChannel = useChannelStore((s) => s.currentChannel)
  const ersatzTVChannels = useErsatztvStore((s) => s.channels)

  return useMemo(() => {
    if (!previousId) return null
    const channel = buildUnifiedChannels(liveChannel, ersatzTVChannels).find((c) => c.id === previousId)
    if (!channel || (channel.type === 'live' && !channel.streamUrl)) return null
    return channel
  }, [previousId, liveChannel, ersatzTVChannels])
}
