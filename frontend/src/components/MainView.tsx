import { useEffect, useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Settings, Film, RefreshCw } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useTVMode } from '@/hooks/useTVMode'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useEPG } from '@/hooks/useEPG'
import { useTheme } from '@/hooks/useTheme'
import { useMobileLandscape } from '@/hooks/useMobileLandscape'
import { VideoPlayer } from '@/components/VideoPlayer'
import { ConnectionStatus } from '@/components/ConnectionStatus'
import { ThemePicker } from '@/components/ThemePicker'
import { AdminModal } from '@/components/AdminModal'
import { useUIStore } from '@/stores/uiStore'
import { useChannelStore } from '@/stores/channelStore'
import { cn } from '@/lib/utils'

export function MainView() {
  const { isAdmin, logout } = useAuth()
  const { status, reconnect } = useWebSocket({ view: 'live' })
  const isTVMode = useTVMode()

  // Initialize theme on app mount - this applies CSS variables and dark/light mode class
  useTheme()
  const isTheaterMode = useUIStore((s) => s.isTheaterMode)
  const setTheaterMode = useUIStore((s) => s.setTheaterMode)
  const setLastRoute = useUIStore((s) => s.setLastRoute)
  const currentChannel = useChannelStore((s) => s.currentChannel)
  const { epg } = useEPG()
  const [videoRefreshKey, setVideoRefreshKey] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [adminModalOpen, setAdminModalOpen] = useState(false)

  // Detect mobile landscape for CSS-based pseudo-fullscreen
  const isMobileLandscape = useMobileLandscape()

  // Track fullscreen changes (for hiding header during autorotate fullscreen)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Track that user visited this route
  useEffect(() => {
    setLastRoute('/')
  }, [setLastRoute])

  // Apply TV mode class to body for global CSS styling
  useEffect(() => {
    if (isTVMode) {
      document.body.classList.add('tv-mode')
    } else {
      document.body.classList.remove('tv-mode')
    }
    return () => {
      document.body.classList.remove('tv-mode')
    }
  }, [isTVMode])

  // Handle Escape key to exit fullscreen or theater mode
  const handleEscape = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else if (isTheaterMode) {
      setTheaterMode(false)
    }
  }, [isTheaterMode, setTheaterMode])

  useEscapeKey({ onEscape: handleEscape })

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header - hidden in theater mode, fullscreen, or mobile landscape */}
      {!isTheaterMode && !isFullscreen && !isMobileLandscape && (
        <header className="flex justify-between items-center px-4 py-2 bg-background border-b">
          <div className="flex items-center gap-4">
            {/* Admin button - left side for admin */}
            {isAdmin && (
              <button
                onClick={() => setAdminModalOpen(true)}
                className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label="Open admin panel"
              >
                <Settings className="h-4 w-4 shrink-0" />
              </button>
            )}
            <ConnectionStatus status={status} onReconnect={reconnect} />
            {/* Theme picker */}
            <ThemePicker />
            {/* Current channel name with EPG display */}
            <span className="text-muted-foreground text-sm">
              {currentChannel?.name
                ? epg?.currentProgram?.title
                  ? `${currentChannel.name} - ${epg.currentProgram.title}`
                  : currentChannel.name
                : 'No channel selected'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* ErsatzTV (Movie Channels) link */}
            <Link
              to="/ersatztv"
              className="h-8 px-3 md:w-[130px] flex items-center justify-center gap-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <Film className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Movies</span>
            </Link>
            <button
              onClick={() => setVideoRefreshKey((k) => k + 1)}
              className="h-8 w-8 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label="Refresh video"
              title="Refresh video"
            >
              <RefreshCw className="h-4 w-4 shrink-0" />
            </button>
            <button
              onClick={logout}
              className="h-8 px-3 text-sm whitespace-nowrap shrink-0 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              Logout
            </button>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* Video Player Area - full viewport in theater mode or mobile landscape */}
        <div
          className={cn(
            'flex items-center justify-center',
            isTheaterMode || isMobileLandscape
              ? 'fixed inset-0 z-50 bg-black'
              : 'flex-1 bg-black w-full'
          )}
        >
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-full h-full max-h-full" key={videoRefreshKey}>
              <VideoPlayer />
            </div>
          </div>
        </div>
      </main>

      {/* Admin Modal - rendered outside header */}
      {isAdmin && (
        <AdminModal
          open={adminModalOpen}
          onOpenChange={setAdminModalOpen}
          view="live"
        />
      )}
    </div>
  )
}
