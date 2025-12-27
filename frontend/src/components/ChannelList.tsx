import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { fetchChannels, setCurrentChannel as setCurrentChannelApi } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Channel } from '@/types'

export function ChannelList() {
  const { channels, currentChannel, isLoading, error, setChannels, setCurrentChannel, setLoading, setError } = useChannelStore()
  const { role } = useAuthStore()
  const isAdmin = role === 'admin'

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

  async function handleSelectChannel(channel: Channel) {
    if (!isAdmin) return

    // Optimistic update
    const previousChannel = currentChannel
    setCurrentChannel(channel)

    try {
      await setCurrentChannelApi(channel)
    } catch (e) {
      // Revert on failure
      setCurrentChannel(previousChannel)
      toast.error('Failed to change channel', {
        description: e instanceof Error ? e.message : 'Please try again',
      })
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
      <div className="flex flex-col gap-2 p-4">
        {channels.map((channel) => (
          <ChannelItem
            key={channel.id}
            channel={channel}
            isSelected={currentChannel?.id === channel.id}
            isAdmin={isAdmin}
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
  isAdmin: boolean
  onSelect: () => void
}

function ChannelItem({
  channel,
  isSelected,
  isAdmin,
  onSelect,
}: ChannelItemProps) {
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isAdmin && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      handleClick()
    }
  }

  return (
    <div
      role={isAdmin ? 'button' : undefined}
      tabIndex={isAdmin ? 0 : undefined}
      onClick={isAdmin ? handleClick : undefined}
      onKeyDown={isAdmin ? handleKeyDown : undefined}
      aria-pressed={isAdmin ? isSelected : undefined}
      aria-disabled={isSelecting}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-4 transition-colors',
        'text-lg',
        'min-h-[56px]',
        isSelected && 'border-primary bg-primary/10',
        isAdmin && !isSelecting && 'cursor-pointer hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
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
}

function ChannelListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}
