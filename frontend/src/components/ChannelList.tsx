import { useEffect, useState, useCallback, forwardRef } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { useRovingTabIndex } from '@/hooks/useRovingTabIndex'
import { fetchChannels, setCurrentChannel as setCurrentChannelApi, clearCurrentChannel as clearCurrentChannelApi, fetchNowPlaying } from '@/services/api'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Channel } from '@/types'

// EPG data structure for storing programme info per channel
interface ChannelEPGData {
  title: string
  start: string
  end: string
}

// Calculate progress percentage for a programme
function calculateProgress(start: string, end: string, currentTime: number): number | null {
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()

  if (currentTime < startTime || currentTime > endTime) return null

  const elapsed = currentTime - startTime
  const duration = endTime - startTime

  if (duration <= 0) return null

  return Math.min(100, Math.max(0, (elapsed / duration) * 100))
}

interface ChannelListProps {
  onChannelSelected?: () => void
}

export function ChannelList({ onChannelSelected }: ChannelListProps = {}) {
  const { channels, currentChannel, isLoading, error, setChannels, setCurrentChannel, setLoading, setError } = useChannelStore()
  const { role } = useAuthStore()
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const isAdmin = role === 'admin'

  // EPG state for all channels
  const [channelEPG, setChannelEPG] = useState<Record<string, ChannelEPGData>>({})
  const [currentTime, setCurrentTime] = useState(Date.now())

  // Fetch EPG data for all channels
  useEffect(() => {
    const fetchAllEPG = async () => {
      const results: Record<string, ChannelEPGData> = {}
      await Promise.all(
        channels.map(async (channel) => {
          // Skip channels without guideId
          if (!channel.guideId) return
          try {
            const data = await fetchNowPlaying(channel.guideId)
            if (data.currentProgram) {
              results[channel.id] = {
                title: data.currentProgram.title,
                start: data.currentProgram.startTime,
                end: data.currentProgram.endTime,
              }
            }
          } catch {
            // Silent fail - EPG data is non-critical
          }
        })
      )
      setChannelEPG(results)
    }

    if (channels.length > 0) {
      fetchAllEPG()
      // Refresh EPG data every 5 minutes
      const interval = setInterval(fetchAllEPG, 5 * 60 * 1000)
      return () => clearInterval(interval)
    }
  }, [channels])

  // Update current time every minute for progress bar updates
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const handleSelectChannel = useCallback(async (channel: Channel) => {
    if (!isAdmin) return

    // Optimistic update
    const previousChannel = currentChannel
    setCurrentChannel(channel)

    // If callback provided (modal context), call it
    // Otherwise use existing sidebar close behavior
    if (onChannelSelected) {
      onChannelSelected()
    } else {
      setSidebarOpen(false)
    }

    try {
      await setCurrentChannelApi(channel)
    } catch (e) {
      // Revert on failure
      setCurrentChannel(previousChannel)
      toast.error('Failed to change channel', {
        description: e instanceof Error ? e.message : 'Please try again',
      })
    }
  }, [isAdmin, currentChannel, setCurrentChannel, setSidebarOpen, onChannelSelected])

  const handleClearChannel = useCallback(async () => {
    if (!isAdmin) return

    const previousChannel = currentChannel
    setCurrentChannel(null)

    // If callback provided (modal context), call it
    // Otherwise use existing sidebar close behavior
    if (onChannelSelected) {
      onChannelSelected()
    } else {
      setSidebarOpen(false)
    }

    try {
      await clearCurrentChannelApi()
    } catch (e) {
      // Revert on failure
      setCurrentChannel(previousChannel)
      toast.error('Failed to clear channel', {
        description: e instanceof Error ? e.message : 'Please try again',
      })
    }
  }, [isAdmin, currentChannel, setCurrentChannel, setSidebarOpen, onChannelSelected])

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
        {/* Clear Channel button - only show when a channel is selected */}
        {currentChannel && isAdmin && (
          <button
            type="button"
            onClick={handleClearChannel}
            className={cn(
              'flex items-center gap-3 rounded-lg border border-destructive/50 p-4 transition-colors',
              'text-lg text-destructive',
              'min-h-[56px] w-full mb-2',
              'cursor-pointer hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <X className="h-5 w-5" />
            <span className="font-medium">Clear Channel</span>
          </button>
        )}
        {channels.map((channel, index) => {
          const epgData = channelEPG[channel.id]
          return (
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
              currentProgramme={epgData?.title || null}
              programmeStart={epgData?.start || null}
              programmeEnd={epgData?.end || null}
              currentTime={currentTime}
            />
          )
        })}
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
  currentProgramme: string | null
  programmeStart: string | null
  programmeEnd: string | null
  currentTime: number
}

const ChannelItem = forwardRef<HTMLDivElement, ChannelItemProps>(function ChannelItem(
  { channel, isSelected, isFocused, isAdmin, tabIndex, onSelect, currentProgramme, programmeStart, programmeEnd, currentTime },
  ref
) {
  const [isSelecting, setIsSelecting] = useState(false)

  // Calculate progress percentage if we have valid start/end times
  const progressPercent = programmeStart && programmeEnd
    ? calculateProgress(programmeStart, programmeEnd, currentTime)
    : null

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
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium truncate">{channel.name}</span>
          {isSelected && (
            <span className="text-sm text-primary flex-shrink-0">Now Playing</span>
          )}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {currentProgramme || 'No programme info'}
        </p>
        {progressPercent !== null && (
          <div className="h-1 w-full bg-muted rounded-full overflow-hidden mt-1.5">
            <div
              className="h-full bg-primary transition-all duration-1000"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>
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
