import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Square } from 'lucide-react'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useRecentLiveChannelIds } from '@/stores/recentLiveStore'
import { useActiveUsers } from '@/hooks/useActiveUsers'
import { presenceNames, usePresenceByChannel } from '@/hooks/usePresenceByChannel'
import { useChannelCatalogue } from '@/hooks/useChannelCatalogue'
import { useSetLiveChannel } from '@/hooks/useSetLiveChannel'
import { fetchNowPlaying, clearCurrentChannel as clearCurrentChannelApi } from '@/services/api'
import { Button } from '@/components/ui/button'
import { StopLiveTVDialog } from '@/components/StopLiveTVDialog'
import { ChannelLogo } from '@/components/ChannelLogo'
import { LivePill } from '@/components/LivePill'
import { PresenceStack } from '@/components/PresenceStack'
import { LIVE_CHANNEL_ID } from '@/stores/tvStore'
import type { Channel } from '@/types'

interface OnAirCardProps {
  /**
   * Called with the card's height whenever it changes (the programme, viewer
   * count and recents rows come and go), so the list scrolling under the card
   * can keep a focused row clear of it.
   */
  onHeightChange?: (height: number) => void
  /**
   * Whether the card has its own row of Recent chips (the default). The Live
   * TV switcher lists recents in a section of its own, so it turns them off.
   */
  showRecents?: boolean
}

/**
 * What's on live TV for everyone and the programme on it, and who else is
 * on it while the admin lets members see what everyone is watching. On the
 * admin Channels tab it also has how many people are watching, one-tap
 * recents and the (confirmed) Stop live TV; the Live TV switcher shows it to
 * everyone allowed to change live TV, and the watching count (from an
 * admin-only endpoint) and Stop are for admins only. Sticky at the top of
 * its scroll container, with the page background so the channel list
 * scrolls underneath.
 */
export function OnAirCard({ onHeightChange, showRecents = true }: OnAirCardProps) {
  const currentChannel = useChannelStore((s) => s.currentChannel)
  const setCurrentChannel = useChannelStore((s) => s.setCurrentChannel)
  const isAdmin = useAuthStore((s) => s.role === 'admin')
  // Everyone else sees the card in the switcher's Suggest a channel
  const canSwitch = useSettingsStore((s) => isAdmin || s.userChannelSelection)

  const cardRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const card = cardRef.current
    if (!card || !onHeightChange) return
    // Fires once on observe, then on every size change
    const observer = new ResizeObserver(() => onHeightChange(card.offsetHeight))
    observer.observe(card)
    return () => observer.disconnect()
  }, [onHeightChange])

  async function stopLiveTV() {
    const previousChannel = useChannelStore.getState().currentChannel
    setCurrentChannel(null)

    try {
      await clearCurrentChannelApi()
    } catch (e) {
      // Revert on failure. The reason goes under the title only when it adds
      // something: a plain failure's message is the title itself.
      setCurrentChannel(previousChannel)
      const title = 'Could not stop live TV'
      const reason = e instanceof Error ? e.message : ''
      toast.error(title, {
        description: reason && reason !== title ? reason : 'Please try again',
      })
    }
  }

  return (
    <section ref={cardRef} aria-label="On air" className="sticky top-0 z-10 bg-background px-4 pt-4">
      <div
        className={
          currentChannel
            ? 'grid gap-3 rounded-xl border border-live/30 bg-live-surface p-4'
            : 'grid gap-3 rounded-xl border bg-card p-4'
        }
      >
        {currentChannel ? (
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {/* Keyed so a logo that failed on the last channel doesn't carry over */}
              <ChannelLogo key={currentChannel.id} channel={currentChannel} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  On air for everyone
                </p>
                <p className="mt-1 flex min-w-0 items-center gap-2 text-lg font-semibold leading-tight">
                  <span className="truncate">{currentChannel.name}</span>
                  <LivePill />
                </p>
                {/* Remounted per channel so the last channel's programme never shows */}
                <CurrentProgramme key={currentChannel.id} channel={currentChannel} />
                <WatchingWith />
                {isAdmin && <WatchingCount />}
              </div>
            </div>
            {/* Keyed by channel so an open confirm is dropped when live TV stops or
                changes elsewhere, instead of reopening when a channel is next picked */}
            {isAdmin && (
              <StopLiveTVControl
                key={currentChannel.id}
                channelName={currentChannel.name}
                onConfirm={stopLiveTV}
              />
            )}
          </div>
        ) : (
          <div>
            <p className="text-lg font-semibold leading-tight">Nothing on live TV</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canSwitch
                ? 'Pick a channel from the list below to put it on for everyone.'
                : 'Pick a channel from the list below to suggest it in chat.'}
            </p>
          </div>
        )}

        {showRecents && <RecentChips currentChannelId={currentChannel?.id ?? null} />}
      </div>
    </section>
  )
}

/**
 * One-tap chips for the channels the signed-in person recently put on live
 * TV, each as the catalogue has it now (its current name and stream), leaving
 * out channels that are gone and, as it already has the card's headline, the
 * channel on air. Nothing until the catalogue has loaded.
 */
function RecentChips({ currentChannelId }: { currentChannelId: string | null }) {
  const username = useAuthStore((s) => s.username)
  const recentIds = useRecentLiveChannelIds(username)
  const catalogue = useChannelCatalogue()
  const setLiveChannel = useSetLiveChannel()

  const otherRecents = recentIds.flatMap((id) => {
    const channel = catalogue?.get(id)
    return channel && channel.id !== currentChannelId ? [channel] : []
  })
  if (otherRecents.length === 0) return null

  return (
    <div role="group" aria-label="Recent live channels" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Recent
      </span>
      {otherRecents.map((channel) => (
        <Button
          key={channel.id}
          variant="outline"
          size="sm"
          className="max-w-full"
          title={`Put ${channel.name} on live TV`}
          onClick={() => setLiveChannel(channel)}
        >
          <span className="truncate">{channel.name}</span>
        </Button>
      ))}
    </div>
  )
}

/** The programme on the live channel now; nothing while loading, without guide data or on error. */
function CurrentProgramme({ channel }: { channel: Channel }) {
  const [title, setTitle] = useState<string | null>(null)
  const { guideId, name } = channel

  useEffect(() => {
    if (!guideId) return
    let cancelled = false
    fetchNowPlaying(guideId, name).then(
      (epg) => {
        if (!cancelled) setTitle(epg.currentProgram?.title ?? null)
      },
      () => {
        // Non-fatal: the card just goes without a programme line
        if (!cancelled) setTitle(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [guideId, name])

  if (!title) return null
  return <p className="mt-1 truncate text-sm text-foreground/80">{title}</p>
}

/**
 * Who else is on live TV ('maya and dev are watching'), from the presence
 * snapshot. Nothing while this viewer doesn't see what everyone is watching
 * (the admin's setting is off, or they hide their own), or nobody else is on
 * it. Unlike the watching count, anyone who sees the card sees it.
 */
function WatchingWith() {
  const people = usePresenceByChannel().get(LIVE_CHANNEL_ID)
  if (!people || people.length === 0) return null

  return (
    <p className="mt-1.5 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <PresenceStack people={people} max={3} className="shrink-0" />
      <span className="truncate">
        {presenceNames(people)} {people.length === 1 ? 'is' : 'are'} watching
      </span>
    </p>
  )
}

/**
 * How many people are on live TV. Presence lists sessions, not people, so one
 * person with two tabs counts once. Only mounted while something is live: the
 * admin-only endpoint polls while mounted.
 */
function WatchingCount() {
  const { data, loading, error } = useActiveUsers()
  if (!data || loading || error) return null

  const people = new Set(data.liveUsers.map((u) => u.username)).size
  return (
    <p className="mt-1 text-sm text-muted-foreground">
      {people === 0 ? 'Nobody watching' : `${people} watching`}
    </p>
  )
}

function StopLiveTVControl({ channelName, onConfirm }: { channelName: string; onConfirm: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={() => setConfirmOpen(true)}
      >
        <Square />
        Stop live TV…
      </Button>
      <StopLiveTVDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        channelName={channelName}
        onConfirm={() => {
          setConfirmOpen(false)
          onConfirm()
        }}
      />
    </>
  )
}
