import { useAuth } from '@/hooks/useAuth'
import { AdminControls } from '@/components/AdminControls'

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
          <p className="text-white text-xl">Video Player (Coming in Epic 2)</p>
        </div>

        {/* Admin Controls - Only visible to admins */}
        {isAdmin && (
          <aside className="w-80 border-l bg-background">
            <AdminControls />
          </aside>
        )}
      </main>
    </div>
  )
}
