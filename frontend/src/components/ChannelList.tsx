import { useEffect, useState, useCallback, forwardRef } from 'react'
import { toast } from 'sonner'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { useRovingTabIndex } from '@/hooks/useRovingTabIndex'
import { fetchChannels, setCurrentChannel as setCurrentChannelApi } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Channel } from '@/types'

export function ChannelList() {
  const { channels, currentChannel, isLoading, error, setChannels, setCurrentChannel, setLoading, setError } = useChannelStore()
  const { role } = useAuthStore()
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const isAdmin = role === 'admin'

  const handleSelectChannel = useCallback(async (channel: Channel) => {
    if (!isAdmin) return

    // Optimistic update
    const previousChannel = currentChannel
    setCurrentChannel(channel)

    // Auto-close drawer after channel selection
    setSidebarOpen(false)

    try {
      await setCurrentChannelApi(channel)
    } catch (e) {
      // Revert on failure
      setCurrentChannel(previousChannel)
      toast.error('Failed to change channel', {
        description: e instanceof Error ? e.message : 'Please try again',
      })
    }
  }, [isAdmin, currentChannel, setCurrentChannel, setSidebarOpen])

  const { focusedIndex, handleKeyDown, getTabIndex, itemRefs } = useRovingTabIndex({
    items: channels,
    onSelect: isAdmin ? handleSelectChannel : undefined,
    getItemId: (channel) => channel.id,
  })

  useEffect(() => {
    loadChannels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadChannels() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchChannels()
      setChannels(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load channels')
    } finally {
      setLoading(false)
    }
  }

  if (isLoading) {
    return <ChannelListSkeleton />
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 p-4">
        <p className="text-destructive">Unable to load channels</p>
        <Button onClick={loadChannels}>Retry</Button>
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <div className="flex items-center justify-center p-4">
        <p className="text-muted-foreground">No channels available</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div
        role="listbox"
        aria-label="Channel list"
        onKeyDown={handleKeyDown}
        className="flex flex-col gap-2 p-4"
      >
        {channels.map((channel, index) => (
          <ChannelItem
            key={channel.id}
            ref={(el) => {
              itemRefs.current[index] = el
            }}
            channel={channel}
            isSelected={currentChannel?.id === channel.id}
            isFocused={index === focusedIndex}
            isAdmin={isAdmin}
            tabIndex={getTabIndex(index)}
            onSelect={() => handleSelectChannel(channel)}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

interface ChannelItemProps {
  channel: Channel
  isSelected: boolean
  isFocused: boolean
  isAdmin: boolean
  tabIndex: 0 | -1
  onSelect: () => void
}

const ChannelItem = forwardRef<HTMLDivElement, ChannelItemProps>(function ChannelItem(
  { channel, isSelected, isFocused, isAdmin, tabIndex, onSelect },
  ref
) {
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
      ref={ref}
      role="option"
      tabIndex={tabIndex}
      onClick={isAdmin ? handleClick : undefined}
      aria-selected={isSelected}
      aria-disabled={isSelecting}
      className={cn(
        'channel-item',
        'flex items-center gap-3 rounded-lg border p-4 transition-colors',
        'text-lg',
        'min-h-[56px]',
        isSelected && 'border-primary bg-primary/10',
        isFocused && 'ring-2 ring-ring ring-offset-2',
        isAdmin && !isSelecting && 'cursor-pointer hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isAdmin && isSelecting && 'cursor-wait opacity-70',
        !isAdmin && 'cursor-default'
      )}
    >
      <span className="font-medium">{channel.name}</span>
      {isSelected && (
        <span className="ml-auto text-sm text-primary">Now Playing</span>
      )}
    </div>
  )
})

function ChannelListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}
