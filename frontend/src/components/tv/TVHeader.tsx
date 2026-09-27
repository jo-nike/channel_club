import { ShieldCheck, LayoutList, Tv } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAppSettings } from '@/hooks/useAppSettings'
import type { WebSocketStatus } from '@/hooks/useWebSocket'
import { useUIStore } from '@/stores/uiStore'
import { ChatToggleButton } from '@/components/ChatToggleButton'
import { AccountMenu } from '@/components/AccountMenu'
import { ConnectionStatus } from '@/components/ConnectionStatus'
import { NowWatching } from '@/components/tv/NowWatching'
import { HeaderAction } from '@/components/HeaderAction'

interface TVHeaderProps {
  status: WebSocketStatus
  onReconnect: () => void
  onOpenAdmin: () => void
  // Opens the live channel picker (the button shows only for non-admins the admin allows)
  onOpenChannelPicker: () => void
  // Reloads the video player (the account menu's Reload stream)
  onReload: () => void
  isMobile: boolean
}

export function TVHeader({
  status,
  onReconnect,
  onOpenAdmin,
  onOpenChannelPicker,
  onReload,
  isMobile,
}: TVHeaderProps) {
  const { isAdmin } = useAuth()
  // Admin-controlled: lets non-admins change the live channel for everyone
  const { userChannelSelection } = useAppSettings()
  const isEPGVisible = useUIStore((s) => s.isEPGVisible)
  const toggleEPG = useUIStore((s) => s.toggleEPG)
  const setGuideFocusRequested = useUIStore((s) => s.setGuideFocusRequested)
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)
  const toggleNHLOverlay = useUIStore((s) => s.toggleNHLOverlay)

  return (
    <header className="flex justify-between items-center gap-3 px-4 pt-header-safe pb-2 bg-background border-b rounded-b-lg">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {/* Connection status indicator */}
        <ConnectionStatus status={status} onReconnect={onReconnect} />
        {/* What's on: two truncating lines, so a long title can't push the video down */}
        <NowWatching isMobile={isMobile} />
      </div>

      {/* Phones keep Host or Change live, Chat and the account menu as 44px targets */}
      <nav aria-label="Watch controls" className="flex shrink-0 items-center gap-1 md:gap-2">
        {/* Guide toggle - desktop only */}
        {!isMobile && (
          <HeaderAction
            icon={<LayoutList />}
            label={isEPGVisible ? 'Hide guide' : 'Show guide'}
            visibleLabel="Guide"
            pressed={isEPGVisible}
            onClick={(e) => {
              // Opened from the keyboard (a click with no pointer presses, as
              // Enter, Space and a remote's OK give): the guide takes focus,
              // so the arrows move through it rather than change the volume
              setGuideFocusRequested(!isEPGVisible && e.detail === 0)
              toggleEPG()
            }}
          />
        )}
        {/* NHL scores toggle - desktop only. The glyph is the word itself. */}
        {!isMobile && (
          <HeaderAction
            icon={
              <span
                aria-hidden="true"
                className="grid size-[18px] place-items-center font-display text-[11px] font-extrabold leading-none tracking-tight"
              >
                NHL
              </span>
            }
            label={isNHLOverlayVisible ? 'Hide NHL Scores' : 'NHL Scores'}
            pressed={isNHLOverlayVisible}
            onClick={toggleNHLOverlay}
          />
        )}
        {/* Host tools for admins; the live channel picker for non-admins the admin allows */}
        {isAdmin ? (
          <HeaderAction
            icon={<ShieldCheck />}
            label="Open admin panel"
            visibleLabel="Host"
            onClick={onOpenAdmin}
          />
        ) : (
          userChannelSelection && (
            <HeaderAction
              icon={<Tv />}
              label="Change live channel"
              visibleLabel="Change live"
              onClick={onOpenChannelPicker}
            />
          )
        )}
        {/* Chat toggle, the one filled action */}
        <ChatToggleButton />
        {/* Account menu: live channel, admin, reload, feedback, pop-ups, theme, sign out */}
        <AccountMenu
          onOpenChannelPicker={onOpenChannelPicker}
          onOpenAdmin={onOpenAdmin}
          onReload={onReload}
          isMobile={isMobile}
        />
      </nav>
    </header>
  )
}
