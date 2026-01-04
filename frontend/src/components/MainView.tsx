import { useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X, Film } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useTVMode } from '@/hooks/useTVMode'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useEPG } from '@/hooks/useEPG'
import { ChannelList } from '@/components/ChannelList'
import { VideoPlayer } from '@/components/VideoPlayer'
import { ConnectionStatus } from '@/components/ConnectionStatus'
import { useUIStore } from '@/stores/uiStore'
import { useChannelStore } from '@/stores/channelStore'
import { cn } from '@/lib/utils'

export function MainView() {
  const { isAdmin, logout } = useAuth()
  const { status, reconnect } = useWebSocket()
  const breakpoint = useBreakpoint()
  const isTVMode = useTVMode()
  const isTheaterMode = useUIStore((s) => s.isTheaterMode)
  const setTheaterMode = useUIStore((s) => s.setTheaterMode)
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const setLastRoute = useUIStore((s) => s.setLastRoute)
  const currentChannel = useChannelStore((s) => s.currentChannel)
  const { epg } = useEPG()

  const isMobile = breakpoint === 'mobile'

  // Track that user visited this route
  useEffect(() => {
    setLastRoute('/')
  }, [setLastRoute])

  // Track the element that triggered the sidebar open for focus restoration
  const sidebarTriggerRef = useRef<HTMLButtonElement | null>(null)

  // Ref for the sidebar drawer to enable focus trapping
  const sidebarDrawerRef = useRef<HTMLElement>(null)

  // Focus trap for sidebar overlay (all breakpoints for admin)
  useFocusTrap(sidebarDrawerRef, {
    enabled: isSidebarOpen,
    restoreFocus: false, // We handle this manually in handleEscape
  })

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

  // Handle Escape key to exit fullscreen, theater mode, or close sidebar
  const handleEscape = useCallback(() => {
    // Priority: fullscreen > theater mode > sidebar
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else if (isTheaterMode) {
      setTheaterMode(false)
    } else if (isSidebarOpen) {
      setSidebarOpen(false)
      // Restore focus to trigger element
      sidebarTriggerRef.current?.focus()
    }
  }, [isTheaterMode, setTheaterMode, isSidebarOpen, setSidebarOpen])

  useEscapeKey({ onEscape: handleEscape })

  // Note: We no longer auto-close sidebar on desktop since admin uses hamburger menu on all breakpoints

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header - hidden in theater mode */}
      {!isTheaterMode && (
        <header className="flex justify-between items-center p-2 bg-background border-b">
          <div className="flex items-center gap-4">
            <ConnectionStatus status={status} onReconnect={reconnect} />
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
              className="h-12 px-4 flex items-center gap-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <Film className="h-5 w-5 shrink-0" />
              <span className="hidden md:inline">Movie Channels</span>
            </Link>
            {/* Menu button - visible on all breakpoints for admin */}
            {isAdmin && (
              <button
                ref={sidebarTriggerRef}
                onClick={(e) => {
                  sidebarTriggerRef.current = e.currentTarget
                  setSidebarOpen(true)
                }}
                className="h-12 w-12 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label="Open channel list"
              >
                <Menu className="h-6 w-6 shrink-0" />
              </button>
            )}
            <button
              onClick={logout}
              className="h-12 px-4 md:px-6 text-base md:text-lg whitespace-nowrap shrink-0 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              Logout
            </button>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* Video Player Area - full viewport in theater mode */}
        <div
          className={cn(
            'flex items-center justify-center',
            isTheaterMode
              ? 'fixed inset-0 z-50 bg-black'
              : 'flex-1 bg-black w-full'
          )}
        >
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-full h-full max-h-full">
              <VideoPlayer />
            </div>
          </div>
        </div>
      </main>

      {/* Sidebar Overlay - admin only, all breakpoints */}
      {!isTheaterMode && isAdmin && (
        <>
          {/* Backdrop */}
          <div
            className={cn(
              'fixed inset-0 z-40 bg-black/50 transition-opacity duration-300',
              isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer */}
          <aside
            ref={sidebarDrawerRef}
            className={cn(
              'fixed inset-y-0 right-0 z-50 bg-background border-l flex flex-col',
              'transform transition-transform duration-300 ease-in-out',
              // Full width on mobile, fixed width on tablet and desktop
              isMobile ? 'w-full' : 'w-80',
              isSidebarOpen ? 'translate-x-0' : 'translate-x-full'
            )}
            aria-label="Channel list"
          >
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="text-xl font-semibold">Channel Selection</h2>
              <button
                onClick={() => setSidebarOpen(false)}
                className="h-12 w-12 flex items-center justify-center bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label="Close channel list"
              >
                <X className="h-6 w-6 shrink-0" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              <ChannelList />
            </div>
          </aside>
        </>
      )}

      {/* Mobile FAB - admin only */}
      {!isTheaterMode && isMobile && !isSidebarOpen && isAdmin && (
        <button
          onClick={(e) => {
            sidebarTriggerRef.current = e.currentTarget
            setSidebarOpen(true)
          }}
          className="fixed bottom-6 right-6 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label="Open channel list"
        >
          <Menu className="h-6 w-6 shrink-0" />
        </button>
      )}
    </div>
  )
}
