import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected'

interface ConnectionStatusProps {
  onReconnect?: () => void
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

export function ConnectionStatus({ status, onReconnect }: ConnectionStatusProps) {
  const [isHidden, setIsHidden] = useState(false)
  const config = statusConfig[status]

  const handleClick = () => {
    setIsHidden((prev) => !prev)
  }

  const tooltipText = isHidden
    ? `${config.text} (hidden)`
    : config.text

  if (status === 'disconnected' && onReconnect) {
    return <button type="button" onClick={onReconnect} className="text-sm text-destructive">Reconnect</button>
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}
