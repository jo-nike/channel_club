import { ShieldCheck, LayoutList, RefreshCw, Tv } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAppSettings } from '@/hooks/useAppSettings'
import type { WebSocketStatus } from '@/hooks/useWebSocket'
import { useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import { ChatToggleButton } from '@/components/ChatToggleButton'
import { FeedbackButton } from '@/components/FeedbackButton'
import { UserSettingsMenu } from '@/components/UserSettingsMenu'
import { ConnectionStatus } from '@/components/ConnectionStatus'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface TVHeaderProps {
  status: WebSocketStatus
  onReconnect: () => void
  // Title of the programme on the selected channel, if known
  currentProgrammeTitle: string | null
  onOpenAdmin: () => void
  // Opens the live channel picker (the button shows only for non-admins the admin allows)
  onOpenChannelPicker: () => void
  // Remounts the video player
  onReload: () => void
  isMobile: boolean
}

export function TVHeader({
  status,
  onReconnect,
  currentProgrammeTitle,
  onOpenAdmin,
  onOpenChannelPicker,
  onReload,
  isMobile,
}: TVHeaderProps) {
  const { logout, isAdmin } = useAuth()
  // Admin-controlled: lets non-admins change the live channel for everyone
  const { userChannelSelection } = useAppSettings()
  const selectedChannel = useTVStore((s) => s.selectedChannel)
  const isEPGVisible = useUIStore((s) => s.isEPGVisible)
  const toggleEPG = useUIStore((s) => s.toggleEPG)
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)
  const toggleNHLOverlay = useUIStore((s) => s.toggleNHLOverlay)

  return (
    <header className="flex justify-between items-center px-4 pt-header-safe pb-2 bg-background border-b rounded-b-lg">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {/* Connection status indicator */}
        <ConnectionStatus status={status} onReconnect={onReconnect} />
        {/* Current channel/programme info: one line, so a long title can't push the video down */}
        <span className="truncate text-muted-foreground text-sm">
          {selectedChannel?.name && currentProgrammeTitle
            ? `${selectedChannel.name} - ${currentProgrammeTitle}`
            : selectedChannel?.name || 'Select a channel'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Guide toggle button - desktop only */}
        {!isMobile && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleEPG}
                className={`
                  h-8 w-8 flex items-center justify-center rounded-md
                  focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                  ${isEPGVisible ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                `}
                aria-pressed={isEPGVisible}
                aria-label={isEPGVisible ? 'Hide guide' : 'Show guide'}
              >
                <LayoutList className="h-4 w-4 shrink-0" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isEPGVisible ? 'Hide guide' : 'Show guide'}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {/* NHL Scores button - desktop only */}
        {!isMobile && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleNHLOverlay}
                className={`
                  h-8 w-8 flex items-center justify-center rounded-md
                  focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                  ${isNHLOverlayVisible ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'bg-muted text-muted-foreground hover:bg-muted/80'}
                `}
                aria-pressed={isNHLOverlayVisible}
                aria-label={isNHLOverlayVisible ? 'Hide NHL Scores' : 'NHL Scores'}
              >
                <svg
                  viewBox="0 0 105 150"
                  className="h-4 w-4"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M52.5 0C23.5 0 0 10 0 10v90c0 30 52.5 50 52.5 50S105 130 105 100V10S81.5 0 52.5 0z" />
                  <text x="52.5" y="85" textAnchor="middle" fontSize="36" fontWeight="bold" fontFamily="Arial" fill="var(--background, #fff)">NHL</text>
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isNHLOverlayVisible ? 'Hide NHL Scores' : 'NHL Scores'}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {/* Channel picker - non-admins, only when the admin has enabled it */}
        {!isAdmin && userChannelSelection && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenChannelPicker}
                className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label="Change live channel"
              >
                <Tv className="h-4 w-4 shrink-0" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Change live channel</p>
            </TooltipContent>
          </Tooltip>
        )}
        {/* Admin button */}
        {isAdmin && (
          <button
            onClick={onOpenAdmin}
            className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Open admin panel"
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
          </button>
        )}
        {/* Refresh video button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onReload}
              className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label="Refresh video"
            >
              <RefreshCw className="h-4 w-4 shrink-0" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Refresh video</p>
          </TooltipContent>
        </Tooltip>
        {/* Feedback (hidden unless the server is configured for it) */}
        <FeedbackButton />
        {/* Chat toggle */}
        <ChatToggleButton />
        {/* User settings (theme + notifications + logout) */}
        <UserSettingsMenu onLogout={logout} />
      </div>
    </header>
  )
}
