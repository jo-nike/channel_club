import { useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { usePlexQRAuth } from '@/hooks/usePlexQRAuth'

export interface QRPlexLoginProps {
  onSuccess: (authToken: string) => void
  onCancel: () => void
  onError?: (error: Error) => void
}

/**
 * QR code-based Plex login component for TV-friendly authentication.
 * Displays a QR code that users can scan with their phone to log in.
 */
export function QRPlexLogin({ onSuccess, onCancel, onError }: QRPlexLoginProps) {
  const { pin, authUrl, status, timeRemaining, error, start, cancel } = usePlexQRAuth({
    onSuccess,
    onError,
  })

  // Start auth flow on mount
  useEffect(() => {
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCancel = () => {
    cancel()
    onCancel()
  }

  const handleRetry = () => {
    start()
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center space-y-6 p-6">
        <h2 className="text-2xl font-bold text-foreground">Sign in with Plex</h2>
        <div
          role="alert"
          className="p-4 text-lg text-destructive-foreground bg-destructive/10 border border-destructive rounded-md text-center"
        >
          {error?.message || 'Unable to start Plex login'}
        </div>
        <div className="flex gap-4">
          <Button
            onClick={handleRetry}
            className="h-12 text-xl px-6 bg-[#E5A00D] hover:bg-[#CC8F0C] text-black"
          >
            Try Again
          </Button>
          <Button
            onClick={handleCancel}
            variant="outline"
            className="h-12 text-xl px-6"
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  // Timeout state
  if (status === 'timeout') {
    return (
      <div className="flex flex-col items-center space-y-6 p-6">
        <h2 className="text-2xl font-bold text-foreground">Sign in with Plex</h2>
        <div
          role="alert"
          className="p-4 text-lg text-muted-foreground bg-muted rounded-md text-center"
        >
          Login timed out. Please try again.
        </div>
        <div className="flex gap-4">
          <Button
            onClick={handleRetry}
            className="h-12 text-xl px-6 bg-[#E5A00D] hover:bg-[#CC8F0C] text-black"
          >
            Try Again
          </Button>
          <Button
            onClick={handleCancel}
            variant="outline"
            className="h-12 text-xl px-6"
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  // Loading/Polling state
  return (
    <div className="flex flex-col items-center space-y-6 p-6">
      <h2 className="text-2xl font-bold text-foreground">Sign in with Plex</h2>

      {/* QR Code */}
      {authUrl ? (
        <div className="bg-white p-4 rounded-lg">
          <QRCodeSVG
            value={authUrl}
            size={280}
            level="M"
            includeMargin={false}
            aria-label="Scan this QR code with your phone to log in"
          />
        </div>
      ) : (
        <div className="w-[312px] h-[312px] bg-muted animate-pulse rounded-lg flex items-center justify-center">
          <span className="text-muted-foreground">Loading...</span>
        </div>
      )}

      {/* Instructions */}
      <p className="text-lg text-muted-foreground text-center">
        Scan with your phone to log in
      </p>

      {/* Manual code */}
      {pin && (
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Or enter this code at{' '}
            <span className="font-mono text-foreground">plex.tv/link</span>
          </p>
          <p className="text-3xl font-mono font-bold text-foreground mt-2 tracking-widest">
            {pin.code}
          </p>
        </div>
      )}

      {/* Status */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="w-2 h-2 bg-[#E5A00D] rounded-full animate-pulse" />
        <span>Waiting for login... ({formatTime(timeRemaining)})</span>
      </div>

      {/* Cancel button */}
      <Button
        onClick={handleCancel}
        variant="outline"
        className="h-12 text-xl px-8"
      >
        Cancel
      </Button>
    </div>
  )
}
