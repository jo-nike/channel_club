import { useCallback, useEffect, useState } from 'react'
import { useChannelZap } from '@/hooks/useChannelZap'
import { useLiveChangeAnnouncement } from '@/hooks/useLiveChangeAnnouncement'
import { getFullscreenElement } from '@/hooks/useFullscreenState'
import { getRemoteAction, isKeyForFocusedControl } from '@/lib/remoteKeys'
import { useTVStore } from '@/stores/tvStore'
import { DualModeVideoPlayer } from '@/components/tv/DualModeVideoPlayer'
import { ZapBanner } from '@/components/tv/ZapBanner'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'

interface CouchViewProps {
  /** Opens the live TV switcher; only for people allowed to change live TV */
  onPickLive?: () => void
}

// The couch has no theater layout to switch: the player always fills the screen
const noTheaterToggle = () => {}

/**
 * The 10-foot layout for TV browsers (useTVMode): the player fills the
 * screen, driven from a remote, with the channel banner over it. No header,
 * guide grid, channel list, resize handle or chat: a remote can't reach them,
 * and a 48-hour grid is too heavy for a TV's chip.
 *
 * TVView renders it after its shared hooks, so the one WebSocket, the
 * presence updates and the programme loading stay there. This view reads the
 * stores it needs itself.
 *
 * CH+/CH- and Up/Down zap, tuning once the presses stop. Back leaves
 * fullscreen, and is otherwise the browser's.
 */
export function CouchView({ onPickLive }: CouchViewProps) {
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
  const { pending: zapPending, step: zapStep } = zap

  // The info rail stays away here: the channel banner tells a viewer on
  // channel 0 who changed the live channel instead
  const liveChange = useLiveChangeAnnouncement(selectedChannel?.type === 'live')

  // Bumped by the player's error fallback
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    // Capture phase, so the remote's keys run before (and instead of) the
    // player's and the page's own handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isKeyForFocusedControl(e)) return
      const action = getRemoteAction(e)
      if (action === 'channelUp' || action === 'channelDown') {
        e.preventDefault()
        e.stopPropagation()
        zapStep(action === 'channelUp' ? 1 : -1)
      } else if (action === 'back' && getFullscreenElement()) {
        // Stops webOS Back (461) and Backspace from also navigating history
        e.preventDefault()
        e.stopPropagation()
        document.exitFullscreen().catch(() => {})
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [zapStep])

  return (
    <div className="couch-view fixed inset-0 overflow-hidden bg-black">
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
    </div>
  )
}
