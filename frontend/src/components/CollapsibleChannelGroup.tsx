import { useState, forwardRef, useImperativeHandle } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { ChannelLogo } from '@/components/ChannelLogo'
import { cn } from '@/lib/utils'
import type { Channel, ChannelGroupWithChannels, Program } from '@/types'

interface CollapsibleChannelGroupProps {
  group: ChannelGroupWithChannels
  currentChannelId: string | null
  canSelect: boolean
  onSelectChannel: (channel: Channel) => void
  /** Keeps the group open while true (search results); it can't be collapsed meanwhile. */
  forceOpen?: boolean
  /** Starts the group open. Only the first render reads it, so the group can still be collapsed. */
  defaultOpen?: boolean
  /** Current programme per channel, keyed by Channel.guideId. */
  nowPlaying?: Record<string, Program>
}

export interface CollapsibleChannelGroupHandle {
  setOpen: (open: boolean) => void
}

export const CollapsibleChannelGroup = forwardRef<CollapsibleChannelGroupHandle, CollapsibleChannelGroupProps>(
  function CollapsibleChannelGroup(
    { group, currentChannelId, canSelect, onSelectChannel, forceOpen = false, defaultOpen = false, nowPlaying },
    ref
  ) {
    const [isOpen, setIsOpen] = useState(forceOpen || defaultOpen)
    const [hasOpened, setHasOpened] = useState(forceOpen || defaultOpen)

    // Expose setOpen method to parent
    useImperativeHandle(ref, () => ({
      setOpen: (open: boolean) => {
        setIsOpen(open)
        if (open) setHasOpened(true)
      },
    }))

    // Update open state when forceOpen changes (for search filtering)
    if (forceOpen && !isOpen) {
      setIsOpen(true)
      setHasOpened(true)
    }

    const handleOpenChange = (open: boolean) => {
      setIsOpen(open)
      if (open) setHasOpened(true)
    }

    return (
      <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
        <CollapsibleTrigger
          className={cn(
            'flex items-center justify-between w-full p-3 rounded-lg transition-colors',
            'hover:bg-accent focus-visible:-outline-offset-2',
            'text-left font-medium'
          )}
        >
          <div className="flex items-center gap-2">
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 transition-transform duration-200',
                isOpen && 'rotate-180'
              )}
            />
            <span className="truncate">{group.name}</span>
          </div>
          <Badge variant="secondary" className="ml-2 shrink-0">
            {group.channelCount}
          </Badge>
        </CollapsibleTrigger>
        <CollapsibleContent className="pl-6 space-y-1">
          {hasOpened && group.channels.map((channel) => (
            <ChannelGroupItem
              key={channel.id}
              channel={channel}
              isSelected={currentChannelId === channel.id}
              canSelect={canSelect}
              currentProgramme={nowPlaying?.[channel.guideId]?.title}
              onSelect={() => onSelectChannel(channel)}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    )
  }
)

interface ChannelGroupItemProps {
  channel: Channel
  isSelected: boolean
  canSelect: boolean
  currentProgramme?: string
  onSelect: () => void
}

function ChannelGroupItem({
  channel,
  isSelected,
  canSelect,
  currentProgramme,
  onSelect,
}: ChannelGroupItemProps) {
  const [isSelecting, setIsSelecting] = useState(false)

  async function handleClick() {
    if (!canSelect || isSelecting) return
    setIsSelecting(true)
    try {
      await onSelect()
    } finally {
      setIsSelecting(false)
    }
  }

  return (
    <div
      role="option"
      tabIndex={0}
      onClick={canSelect ? handleClick : undefined}
      onKeyDown={(e) => {
        if (canSelect && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          handleClick()
        }
      }}
      aria-selected={isSelected}
      aria-disabled={isSelecting}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-colors',
        'text-base',
        'min-h-[48px] focus-visible:-outline-offset-2',
        isSelected && 'border-primary bg-primary/10',
        canSelect && !isSelecting && 'cursor-pointer hover:bg-accent',
        canSelect && isSelecting && 'cursor-wait opacity-70',
        !canSelect && 'cursor-default'
      )}
    >
      <ChannelLogo channel={channel} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium truncate">{channel.name}</span>
          {isSelected && (
            <span className="text-sm text-primary flex-shrink-0">Now Playing</span>
          )}
        </div>
        {currentProgramme && (
          <p className="truncate text-sm text-muted-foreground">{currentProgramme}</p>
        )}
      </div>
    </div>
  )
}
