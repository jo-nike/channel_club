import { useAuth } from '@/hooks/useAuth'
import { ChannelList } from '@/components/ChannelList'
import { VideoPlayer } from '@/components/VideoPlayer'

export function MainView() {
  const { isAdmin, logout } = useAuth()

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex justify-between items-center p-4 bg-background border-b">
        <h1 className="text-2xl font-bold">IPTV Viewer</h1>
        <button
          onClick={logout}
          className="h-12 px-6 text-lg bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          Logout
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex">
        {/* Video Player Area */}
        <div className="flex-1 bg-black flex items-center justify-center">
          <VideoPlayer />
        </div>

        {/* Channel List Sidebar - Visible to all authenticated users */}
        <aside className="w-80 border-l bg-background">
          <div className="p-4 border-b">
            <h2 className="text-xl font-semibold">
              {isAdmin ? 'Channel Selection' : 'Channels'}
            </h2>
          </div>
          <ChannelList />
        </aside>
      </main>
    </div>
  )
}
