import { useState } from 'react'
import { cn } from '@/lib/utils'

type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected'

interface ConnectionStatusProps {
  status: ConnectionState
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

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const [isHidden, setIsHidden] = useState(false)
  const config = statusConfig[status]

  const handleClick = () => {
    setIsHidden((prev) => !prev)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'h-3 w-3 rounded-full cursor-pointer transition-colors',
        isHidden ? 'bg-background' : config.color,
        !isHidden && config.pulse && 'animate-pulse'
      )}
      role="status"
      aria-label={isHidden ? `${config.text} (hidden - click to show)` : `${config.text} (click to hide)`}
    />
  )
}
