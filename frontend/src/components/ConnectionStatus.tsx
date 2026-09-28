import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'restarting' | 'disconnected'

interface ConnectionStatusProps {
  onReconnect?: () => void
  status: ConnectionState
}

// A blip shorter than this, including the first connect after a page load
// (the socket starts out 'disconnected'), shows nothing at all
const SHOW_AFTER_MS = 3000

/**
 * The chat socket's health, shown only when it's degraded. The socket
 * carries chat, presence and live-channel sync, not the video.
 */
export function ConnectionStatus({ status, onReconnect }: ConnectionStatusProps) {
  const isDegraded = status !== 'connected'
  const [isShown, setIsShown] = useState(false)

  // Once the socket has given up, the offline pill stays until it's back.
  // The slow retries pass through 'reconnecting' on every attempt, which would
  // otherwise flip the pill to amber and hide Retry each time. Only a change
  // into 'disconnected' counts, so the initial 'disconnected' before the first
  // connect doesn't. (Adjusted while rendering, React's pattern for state that
  // follows a prop.)
  const [prevStatus, setPrevStatus] = useState(status)
  const [connectionLost, setConnectionLost] = useState(false)
  if (status !== prevStatus) {
    setPrevStatus(status)
    if (status === 'disconnected') setConnectionLost(true)
    else if (status === 'connected') setConnectionLost(false)
  }

  // Keyed on being degraded rather than on the status, so moving between the
  // degraded states neither restarts the delay nor hides a pill already shown
  // (state is only set from the timer and the cleanup, never in the effect body)
  useEffect(() => {
    if (!isDegraded) return
    const timer = setTimeout(() => setIsShown(true), SHOW_AFTER_MS)
    return () => {
      clearTimeout(timer)
      setIsShown(false)
    }
  }, [isDegraded])

  // The live region stays mounted, empty and out of the layout while all is
  // well, so screen readers already track it when 'Chat offline' goes in. A
  // region mounted together with its message often isn't announced.
  // A server restart is announced, not a blip, so it shows at once
  const isRestarting = status === 'restarting'
  const isVisible = isDegraded && (isShown || isRestarting)
  const isOffline = status === 'disconnected' || connectionLost
  const isTrying = status === 'connecting' || status === 'reconnecting' || isRestarting
  const label = isOffline
    ? 'Chat offline'
    : isRestarting
      ? 'Channel Club is restarting for an update, back in a few seconds'
      : status === 'connecting' ? 'Connecting...' : 'Reconnecting...'
  const state = isOffline ? 'offline' : status === 'connecting' ? 'connecting' : 'reconnecting'

  return (
    <span
      role="status"
      aria-live="polite"
      data-slot="connection-status"
      className={cn('inline-flex shrink-0 items-center gap-1', !isVisible && 'sr-only')}
    >
      {isVisible && (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Focusable so keyboard users can reach the explanation too */}
            <span
              tabIndex={0}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium',
                isOffline ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning'
              )}
            >
              {/* Pulses while an attempt is under way, including the slow ones behind 'Chat offline' */}
              <span
                aria-hidden="true"
                data-testid="connection-dot"
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  isOffline ? 'bg-destructive' : 'bg-warning',
                  isTrying && 'motion-safe:animate-pulse'
                )}
              />
              {label}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Chat and live-channel sync are {state}. Video is not affected.</p>
          </TooltipContent>
        </Tooltip>
      )}
      {isVisible && isOffline && onReconnect && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onReconnect}>
          Retry
        </Button>
      )}
    </span>
  )
}
