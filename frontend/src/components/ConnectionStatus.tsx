import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected'

interface ConnectionStatusProps {
  status: ConnectionState
  onReconnect?: () => void
}

const statusConfig = {
  connected: {
    color: 'bg-green-500',
    text: 'Connected',
    pulse: false,
  },
  connecting: {
    color: 'bg-yellow-500',
    text: 'Connecting...',
    pulse: true,
  },
  reconnecting: {
    color: 'bg-yellow-500',
    text: 'Reconnecting...',
    pulse: true,
  },
  disconnected: {
    color: 'bg-red-500',
    text: 'Disconnected',
    pulse: false,
  },
} as const

export function ConnectionStatus({ status, onReconnect }: ConnectionStatusProps) {
  const config = statusConfig[status]

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn('h-3 w-3 rounded-full', config.color, config.pulse && 'animate-pulse')}
        role="status"
        aria-label={config.text}
      />

      {status === 'disconnected' && onReconnect && (
        <Button variant="outline" size="sm" onClick={onReconnect}>
          Reconnect
        </Button>
      )}
    </div>
  )
}
