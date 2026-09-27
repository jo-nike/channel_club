import { useCallback, useEffect, useState } from 'react'
import { useChannelZap } from '@/hooks/useChannelZap'
import { useLiveChangeAnnouncement } from '@/hooks/useLiveChangeAnnouncement'
import { getFullscreenElement } from '@/hooks/useFullscreenState'
import { getRemoteAction, getRemoteDigit, isKeyForFocusedControl } from '@/lib/remoteKeys'
import { cn } from '@/lib/utils'
import { useTVStore } from '@/stores/tvStore'
import { DualModeVideoPlayer } from '@/components/tv/DualModeVideoPlayer'
import { ZapBanner } from '@/components/tv/ZapBanner'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AccountMenu } from '@/components/AccountMenu'
import { Button } from '@/components/ui/button'
import { CouchGuide } from './CouchGuide'

interface CouchViewProps {
  /** Opens the live TV switcher; only for people allowed to change live TV */
  onPickLive?: () => void
  /** The account menu's Change live channel (it offers it only to those allowed) */
  onOpenChannelPicker: () => void
  onOpenAdmin: () => void
}

// The couch has no theater layout to switch: the player always fills the screen
const noTheaterToggle = () => {}

// How long the pointer rests before it hides
const CURSOR_IDLE_MS = 3000

/**
 * True once the mouse has rested for CURSOR_IDLE_MS. An LG Magic Remote
 * moves a pointer the viewer aims with, so it only hides at rest, and shows
 * again on the next move or click.
 */
function useIdleCursor(): boolean {
  const [isIdle, setIdle] = useState(false)

  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS)
    const wake = () => {
      clearTimeout(timer)
      setIdle(false)
      timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS)
    }
    window.addEventListener('mousemove', wake)
    window.addEventListener('mousedown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('mousedown', wake)
    }
  }, [])

  return isIdle
}

/**
 * Fullscreen for the whole page, not just the player: the channel banner,
 * dialogs and toasts stay on screen. Browsers only allow it from a user
 * gesture, such as the OK press this answers.
 */
function requestPageFullscreen() {
  const root = document.documentElement
  if (typeof root.requestFullscreen !== 'function') return
  root.requestFullscreen().catch(() => {})
}

/**
 * The 10-foot layout for TV browsers (useTVMode): the player fills the
 * screen, driven from a remote, with the channel banner over it. No header,
 * guide grid, channel list, resize handle or chat: a remote can't reach them,
 * and a 48-hour grid is too heavy for a TV's chip. Its guide is a now/next
 * list over the picture (CouchGuide). The account menu sits in
 * the top corner, the couch's way to sign out, reach Admin or Feedback, or
 * turn the TV layout off.
 *
 * TVView renders it after its shared hooks, so the one WebSocket, the
 * presence updates and the programme loading stay there. This view reads the
 * stores it needs itself.
 *
 * CH+/CH- and Up/Down zap, tuning once the presses stop. The number keys
 * type a channel number, tuned 1.5s after the last digit or at once on OK.
 * Otherwise OK, with nothing focused, opens the guide, as does the remote's
 * Guide or Info key; the first also takes the page fullscreen (a browser
 * only allows that from a key press or a click, so it can't happen on load).
 * The open guide has the keys until it hides. Back leaves fullscreen, and is
 * otherwise the browser's. Play/pause is the player's own (remotePlayPause
 * in its shortcuts). The pointer, and the account menu with it, hide after
 * 3s at rest.
 */
export function CouchView({ onPickLive, onOpenChannelPicker, onOpenAdmin }: CouchViewProps) {
  const selectedChannel = useTVStore((s) => s.selectedChannel)
  const previousChannelId = useTVStore((s) => s.previousChannelId)
  const selectChannel = useTVStore((s) => s.selectChannel)
  const getUnifiedChannels = useTVStore((s) => s.getUnifiedChannels)

  const zap = useChannelZap({
    getChannels: getUnifiedChannels,
    selected: selectedChannel,
    previousId: previousChannelId,
    onTune: selectChannel,
  })
  const { pending: zapPending, step: zapStep, digit: zapDigit, commitDigits } = zap

  // The info rail stays away here: the channel banner tells a viewer on
  // channel 0 who changed the live channel instead
  const liveChange = useLiveChangeAnnouncement(selectedChannel?.type === 'live')

  // Bumped by the player's error fallback
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const [isGuideOpen, setGuideOpen] = useState(false)
  const closeGuide = useCallback(() => setGuideOpen(false), [])

  useEffect(() => {
    // The guide, and the page fullscreen if it isn't yet: this key press is
    // the user gesture a browser asks for
    const openGuide = () => {
      if (!getFullscreenElement()) requestPageFullscreen()
      setGuideOpen(true)
    }
    // Capture phase, so the remote's keys run before (and instead of) the
    // player's and the page's own handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isKeyForFocusedControl(e)) return
      const action = getRemoteAction(e)
      if (action === 'channelUp' || action === 'channelDown') {
        e.preventDefault()
        e.stopPropagation()
        zapStep(action === 'channelUp' ? 1 : -1)
      } else if (action === 'digit') {
        // Remotes' number keys can arrive with no key name, which the
        // player's own shortcuts wouldn't read
        e.preventDefault()
        e.stopPropagation()
        zapDigit(getRemoteDigit(e)!)
      } else if (action === 'ok') {
        // A number being typed takes OK, even from a button the pointer
        // left focused: the viewer is entering a channel
        if (commitDigits()) {
          e.preventDefault()
          e.stopPropagation()
        } else if (!document.activeElement || document.activeElement === document.body) {
          // Otherwise a focused control keeps OK to press it
          e.preventDefault()
          e.stopPropagation()
          openGuide()
        }
      } else if (action === 'guide') {
        e.preventDefault()
        e.stopPropagation()
        openGuide()
      } else if (action === 'back' && getFullscreenElement()) {
        // Stops webOS Back (461) and Backspace from also navigating history
        e.preventDefault()
        e.stopPropagation()
        document.exitFullscreen().catch(() => {})
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [zapStep, zapDigit, commitDigits])

  const isCursorIdle = useIdleCursor()

  return (
    // The pointer hides over everything, the player's buttons included
    <div className={cn('couch-view fixed inset-0 overflow-hidden bg-black', isCursorIdle && 'cursor-none [&_*]:cursor-none!')}>
      <ErrorBoundary
        name="Player"
        // The live slot keeps one id across channel changes, so the stream
        // URL is part of the key too. A reload also clears it.
        resetKey={`${selectedChannel ? `${selectedChannel.id} ${selectedChannel.streamUrl}` : ''} ${reloadKey}`}
        fallback={() => (
          <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-3 text-white">
            <p>The player hit an error</p>
            <Button variant="secondary" onClick={reload}>
              Reload player
            </Button>
          </div>
        )}
      >
        <DualModeVideoPlayer
          channel={selectedChannel}
          isTheaterMode
          onTheaterModeToggle={noTheaterToggle}
          onPickLive={onPickLive}
          reloadKey={reloadKey}
          zap={zap}
        />
      </ErrorBoundary>
      {/* A typed number shows its channel once it matches one, and its
          digits until then */}
      <ZapBanner
        channel={zapPending ?? selectedChannel}
        entry={zapPending ? null : zap.entry}
        missing={zap.missing}
        liveChange={zapPending ? null : liveChange}
      />
      {isGuideOpen && <CouchGuide onClose={closeGuide} canPickLive={!!onPickLive} />}
      {/* Without it, a TV layout switched On would have no way back: it shows
          while the pointer moves, so a Magic Remote or mouse can reach it, and
          while it has keyboard focus, and fades with the idle pointer so it
          stays off the picture */}
      <div
        className={cn(
          'absolute right-(--couch-safe-x) top-(--couch-safe-y) z-20 transition-opacity duration-300 has-[:focus-visible]:opacity-100',
          isCursorIdle && 'opacity-0'
        )}
      >
        <AccountMenu
          onOpenChannelPicker={onOpenChannelPicker}
          onOpenAdmin={onOpenAdmin}
          onReload={reload}
          isMobile={false}
        />
      </div>
    </div>
  )
}
