import { useCallback, useEffect, useState, useSyncExternalStore, type FocusEvent, type MouseEvent } from 'react'
import mpegts from 'mpegts.js'
import { X } from 'lucide-react'
import { PresenceStack } from '@/components/PresenceStack'
import { Button } from '@/components/ui/button'
import { usePlayerShell } from '@/components/player/PlayerShellContext'
import { usePresenceByChannel } from '@/hooks/usePresenceByChannel'
import { useTVMode } from '@/hooks/useTVMode'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { LIVE_CHANNEL_ID, useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import type { UnifiedChannel } from '@/types'

/** sessionStorage key: the card has shown in this browser session */
export const ARRIVAL_SHOWN_KEY = 'arrival-shown'
/** How long the card stays up untouched */
export const ARRIVAL_DISMISS_MS = 12_000
/**
 * How long after the player opens friends on live still count as where the
 * group was on arrival: presence comes over the WebSocket a moment after load
 */
export const ARRIVAL_WINDOW_MS = 30_000
// Friends' faces before the rest become '+n'
const FRIENDS_SHOWN_MAX = 4
/**
 * The shortest player the card fits in under the info rail without reaching
 * the control bar: the rail's 4.25rem, the card (about 150px, more when its
 * text wraps) and the control bar's buttons (the bottom 56px). A phone's 16:9
 * player is about 210px tall. On a shorter player the card stays over the
 * rail instead, which covers what is on, not a control, so this errs high.
 */
export const UNDER_RAIL_MIN_PLAYER_HEIGHT = 320

function wasShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(ARRIVAL_SHOWN_KEY) !== null
  } catch {
    return false
  }
}

function markShownThisSession(): void {
  try {
    sessionStorage.setItem(ARRIVAL_SHOWN_KEY, '1')
  } catch {
    // Storage blocked: the card can come back on the next load
  }
}

type Phase = 'waiting' | 'welcome' | 'friends' | 'done'

interface ArrivalCardProps {
  /** The channel the player is on; null before the TV store has one */
  channel: UnifiedChannel | null
}

/** Whether the player shell is tall enough for the card under the info rail */
function useFitsUnderRail(): boolean {
  const { containerRef } = usePlayerShell()
  const subscribe = useCallback(
    (onChange: () => void) => {
      const shell = containerRef.current
      if (!shell) return () => {}
      const observer = new ResizeObserver(onChange)
      observer.observe(shell)
      return () => observer.disconnect()
    },
    [containerRef]
  )
  return useSyncExternalStore(
    subscribe,
    () => (containerRef.current?.clientHeight ?? 0) >= UNDER_RAIL_MIN_PLAYER_HEIGHT
  )
}

/**
 * A small card over the top-left of the picture when someone arrives, once
 * per browser session. Never a modal: it is a status message with its own
 * close button, and it closes itself after 12s (held while the pointer or
 * focus is on it).
 *
 * The first visit (until the welcome is closed) greets the viewer by name and
 * says what channel 0 is, with 'Join live' while live TV has something on
 * (and the viewer isn't on it already) and 'Browse channels', which opens the
 * guide. Join is hidden where the browser can't play the live stream (no MSE,
 * as on iPhone Safari). Closing the welcome in any of those ways marks it
 * seen; letting it time out doesn't, so it comes back next session.
 *
 * After that, arriving while live TV is on, the viewer is elsewhere and
 * others are on channel 0 says '3 friends are watching TSN 5', with Join and
 * Stay. That needs presence to show channels to this viewer (the admin
 * setting, and not hiding their own), and it only counts in the first 30s,
 * the arrival, not whenever someone tunes in later. It goes once the viewer
 * is on live or nobody else is. Join and Stay are hidden where the live
 * stream can't play, which leaves the close button.
 *
 * It sits in the player shell beside the info rail and NHL ticker, so it
 * shows in theater and fullscreen and stays put across channel changes. It
 * waits for the first tune, and hides while the NHL ticker is open. It waits
 * while the autoplay notice is up, whose 'Sound is off' pill shares the top of
 * the picture and would be covered on a narrow player: that tap brings the
 * sound back. Its 12s don't run while it waits. It never hides for the info
 * rail: pointing at the player, a key (Tab included) and a tap on the card
 * itself all raise the rail, so a card that hid for it could never be used.
 * While the rail is up the card moves under it, like the ticker, on a player
 * tall enough to fit it above the control bar; on a shorter one, such as a
 * phone's or a laptop's with the guide open, it stays where it is, over the
 * rail. Not on the TV layout, whose channel banner has that corner and whose
 * remote can't reach it.
 */
export function ArrivalCard({ channel }: ArrivalCardProps) {
  const { isInfoRailVisible, isAutoplayNoticeShown } = usePlayerShell()
  const fitsUnderRail = useFitsUnderRail()
  const isTVMode = useTVMode()
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)
  const hasSeenWelcome = useUIStore((s) => s.hasSeenWelcome)
  const setHasSeenWelcome = useUIStore((s) => s.setHasSeenWelcome)
  const username = useAuthStore((s) => s.username)
  const isLiveOn = useChannelStore((s) => s.currentChannel !== null)
  const hasTuned = channel !== null
  const isOnLive = channel?.type === 'live'
  // The live channel is an MPEG-TS stream, which needs Media Source Extensions
  const [canPlayLive] = useState(() => mpegts.isSupported())
  const liveName = useChannelStore((s) => s.currentChannel?.name ?? null)
  const liveTitle = useTVStore((s) => s.liveEPG?.currentProgram?.title ?? null)
  // Empty unless presence shows channels to this viewer; this viewer isn't in it
  const friends = usePresenceByChannel().get(LIVE_CHANNEL_ID) ?? []

  const [phase, setPhase] = useState<Phase>(() => (wasShownThisSession() ? 'done' : 'waiting'))
  const [isPointerOver, setPointerOver] = useState(false)
  const [hasFocusWithin, setFocusWithin] = useState(false)
  const [isArriving, setArriving] = useState(true)

  const isWaiting = phase === 'waiting'
  useEffect(() => {
    if (!isWaiting) return
    const timer = setTimeout(() => setArriving(false), ARRIVAL_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [isWaiting])

  // Friends are where the group is only while this viewer is somewhere else
  const hasFriendsOnLive = isLiveOn && hasTuned && !isOnLive && friends.length > 0

  // Shown once the player has a channel, as it arrives rather than over the
  // empty player (adjusted while rendering, React's pattern for state that
  // follows other state)
  if (isWaiting && !isTVMode && hasTuned && !isNHLOverlayVisible) {
    if (!hasSeenWelcome) setPhase('welcome')
    else if (isArriving && hasFriendsOnLive) setPhase('friends')
  }
  // The arrival is over with nobody to point at
  if (isWaiting && hasSeenWelcome && !isArriving) setPhase('done')
  // Nothing left to join: the viewer went to live, or everyone left it
  if (phase === 'friends' && !hasFriendsOnLive) setPhase('done')
  const isShowing = phase === 'welcome' || phase === 'friends'
  // Clear of the sound-off pill
  const isDeferred = isAutoplayNoticeShown
  // Clear of the control bar on a short player
  const isUnderRail = isInfoRailVisible && fitsUnderRail
  const isVisible = isShowing && !isNHLOverlayVisible && !isDeferred

  // Hidden under the pointer or with focus in it, it never hears them leave
  if (!isVisible && (isPointerOver || hasFocusWithin)) {
    setPointerOver(false)
    setFocusWithin(false)
  }

  useEffect(() => {
    if (isVisible) markShownThisSession()
  }, [isVisible])

  const isHeld = isPointerOver || hasFocusWithin || isDeferred
  useEffect(() => {
    if (!isShowing || isHeld) return
    const timer = setTimeout(() => setPhase('done'), ARRIVAL_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [isShowing, isHeld])

  if (isTVMode || phase === 'done') return null

  const close = () => {
    if (phase === 'welcome') setHasSeenWelcome(true)
    setPhase('done')
  }

  // A click, so it is a user gesture: the new stream may start with sound
  const joinLive = () => {
    const tv = useTVStore.getState()
    tv.selectChannel(tv.getUnifiedChannels()[0])
    close()
  }

  // As the header's Guide button: the guide takes focus when opened from the keyboard
  const browseChannels = (e: MouseEvent<HTMLButtonElement>) => {
    const ui = useUIStore.getState()
    if (!ui.isEPGVisible) {
      ui.setGuideFocusRequested(e.detail === 0)
      ui.setEPGVisible(true)
    }
    close()
  }

  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false)
  }

  const showJoin = isLiveOn && !isOnLive && canPlayLive

  return (
    // There, empty, while the card is still to come, so screen readers hear
    // it when it fills in; gone once it has been
    <div
      role="status"
      data-testid="arrival-card"
      className={cn(
        'pointer-events-none absolute left-[max(1rem,env(safe-area-inset-left))] z-30 w-80 max-w-[calc(100%-2rem)] motion-safe:transition-[top] motion-safe:duration-300',
        // The rail's height (0.75rem above its 3rem row, plus the shell's top inset) and a gap
        isUnderRail ? 'top-[calc(4.25rem+var(--player-inset-top,0px))]' : 'top-[calc(1rem+var(--player-inset-top,0px))]'
      )}
    >
      {isVisible && (
        // video-controls: a tap here uses the card rather than toggling the controls
        <div
          className="video-controls pointer-events-auto rounded-xl border border-white/15 bg-black/85 p-3 text-white shadow-xl backdrop-blur-md"
          onPointerEnter={() => setPointerOver(true)}
          onPointerLeave={() => setPointerOver(false)}
          onFocus={() => setFocusWithin(true)}
          onBlur={handleBlur}
        >
          <div className="flex items-start gap-2">
            {phase === 'friends' && (
              <PresenceStack people={friends} max={FRIENDS_SHOWN_MAX} className="shrink-0 pt-1.5" />
            )}
            <p className="min-w-0 flex-1 pt-1.5 text-base font-bold leading-tight">
              {phase === 'friends'
                ? describeFriends(friends.length, liveName ?? 'live TV')
                : username
                  ? `Welcome, ${username}`
                  : 'Welcome'}
            </p>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-ring-media"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {phase === 'friends' ? (
            <>
              <p className="mt-1 text-sm leading-snug text-white/80">
                {liveTitle ? `${liveTitle}, live on channel 0` : 'Live on channel 0, the club channel'}
              </p>
              {showJoin && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={joinLive} className="focus-ring-media">
                    Join
                  </Button>
                  <Button variant="secondary" size="sm" onClick={close} className="focus-ring-media">
                    Stay
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mt-1 text-sm leading-snug text-white/80">
                Channel 0 is the club channel: whoever hosts picks it and everyone can join.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {showJoin && (
                  <Button size="sm" onClick={joinLive} className="focus-ring-media">
                    Join live
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={browseChannels} className="focus-ring-media">
                  Browse channels
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** '1 friend is watching TSN 5', '3 friends are watching TSN 5' */
function describeFriends(count: number, channelName: string): string {
  return count === 1 ? `1 friend is watching ${channelName}` : `${count} friends are watching ${channelName}`
}
