import { useState, useEffect } from 'react'
import { WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90">
      <div className="p-8 text-center">
        <WifiOff className="mx-auto mb-4 h-16 w-16 text-slate-400" />
        <h2 className="mb-2 text-2xl font-bold text-white">Network Unavailable</h2>
        <p className="mb-4 text-slate-400">Please check your connection</p>
        <Button onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    </div>
  )
}
