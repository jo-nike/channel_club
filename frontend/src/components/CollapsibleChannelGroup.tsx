import { useState, forwardRef, useImperativeHandle } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Channel, ChannelGroupWithChannels } from '@/types'

interface CollapsibleChannelGroupProps {
  group: ChannelGroupWithChannels
  currentChannelId: string | null
  isAdmin: boolean
  onSelectChannel: (channel: Channel) => void
  forceOpen?: boolean
}

export interface CollapsibleChannelGroupHandle {
  setOpen: (open: boolean) => void
}

export const CollapsibleChannelGroup = forwardRef<CollapsibleChannelGroupHandle, CollapsibleChannelGroupProps>(
  function CollapsibleChannelGroup(
    { group, currentChannelId, isAdmin, onSelectChannel, forceOpen = false },
    ref
  ) {
    const [isOpen, setIsOpen] = useState(forceOpen)

    // Expose setOpen method to parent
    useImperativeHandle(ref, () => ({
      setOpen: (open: boolean) => setIsOpen(open),
    }))

    // Update open state when forceOpen changes (for search filtering)
    if (forceOpen && !isOpen) {
      setIsOpen(true)
    }

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger
          className={cn(
            'flex items-center justify-between w-full p-3 rounded-lg transition-colors',
            'hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
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
          {group.channels.map((channel) => (
            <ChannelGroupItem
              key={channel.id}
              channel={channel}
              isSelected={currentChannelId === channel.id}
              isAdmin={isAdmin}
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
  isAdmin: boolean
  onSelect: () => void
}

function ChannelGroupItem({ channel, isSelected, isAdmin, onSelect }: ChannelGroupItemProps) {
  const [isSelecting, setIsSelecting] = useState(false)

  async function handleClick() {
    if (!isAdmin || isSelecting) return
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
      onClick={isAdmin ? handleClick : undefined}
      onKeyDown={(e) => {
        if (isAdmin && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          handleClick()
        }
      }}
      aria-selected={isSelected}
      aria-disabled={isSelecting}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-colors',
        'text-base',
        'min-h-[48px]',
        isSelected && 'border-primary bg-primary/10',
        isAdmin && !isSelecting && 'cursor-pointer hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        isAdmin && isSelecting && 'cursor-wait opacity-70',
        !isAdmin && 'cursor-default'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium truncate">{channel.name}</span>
          {isSelected && (
            <span className="text-sm text-primary flex-shrink-0">Now Playing</span>
          )}
        </div>
      </div>
    </div>
  )
}
