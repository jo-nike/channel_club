import { useState, useEffect } from 'react'
import { WifiOff } from 'lucide-react'

/**
 * A slim bar while the browser is offline. It doesn't block anything: video
 * already buffered keeps playing, and the socket and guide recover by
 * themselves when the connection comes back, so there's nothing to reload.
 */
export function OfflineFallback() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (isOnline) return null

  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 bg-warning pt-safe text-warning-foreground shadow-sm">
      <p className="flex min-h-8 items-center justify-center gap-2 px-4 py-1 text-center text-xs leading-tight sm:text-sm">
        <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        You're offline. Chat and the guide will catch up when you reconnect.
      </p>
    </div>
  )
}
