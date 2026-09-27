import { useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { usePlexQRAuth } from '@/hooks/usePlexQRAuth'
import { cn } from '@/lib/utils'

export type QRPlexLoginVariant = 'default' | 'tv'

export interface QRPlexLoginProps {
  onSuccess: (authToken: string) => void
  onCancel: () => void
  onError?: (error: Error) => void
  /** Each time a new code is asked for (the first, Try Again, auto-restarts). */
  onCodeRequested?: () => void
  /** 'tv': two columns sized to read from the sofa (steps and code left, a 400px QR right). */
  variant?: QRPlexLoginVariant
  /** Start over with a fresh code on timeout, a few times, before showing Try Again. */
  autoRestart?: boolean
  /** Label for the button that leaves the code screen. */
  cancelLabel?: string
}

const QR_SIZE: Record<QRPlexLoginVariant, number> = { default: 280, tv: 400 }

/**
 * QR code-based Plex login component for TV-friendly authentication.
 * Displays a QR code that users can scan with their phone to log in.
 */
export function QRPlexLogin({
  onSuccess,
  onCancel,
  onError,
  onCodeRequested,
  variant = 'default',
  autoRestart = false,
  cancelLabel = 'Cancel',
}: QRPlexLoginProps) {
  const { shortPin, authUrl, status, timeRemaining, error, start, cancel } = usePlexQRAuth({
    onSuccess,
    onError,
    onCodeRequested,
    autoRestart,
  })
  const tv = variant === 'tv'
  const headingClass = cn('font-bold text-foreground', tv ? 'text-4xl' : 'text-2xl')
  const actionClass = tv ? 'h-14 text-2xl px-8' : 'h-12 text-xl px-6'

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
        <h2 className={headingClass}>Sign in with Plex</h2>
        <div
          role="alert"
          className={cn(
            'p-4 text-foreground bg-destructive/10 border border-destructive rounded-md text-center',
            tv ? 'text-2xl' : 'text-lg'
          )}
        >
          {error?.message || 'Unable to start Plex login'}
        </div>
        <div className="flex gap-4">
          <Button
            onClick={handleRetry}
            className={cn(actionClass, 'bg-[#E5A00D] hover:bg-[#CC8F0C] text-black')}
          >
            Try Again
          </Button>
          <Button
            onClick={handleCancel}
            variant="outline"
            className={actionClass}
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    )
  }

  // Timeout state
  if (status === 'timeout') {
    return (
      <div className="flex flex-col items-center space-y-6 p-6">
        <h2 className={headingClass}>Sign in with Plex</h2>
        <div
          role="alert"
          className={cn('p-4 text-muted-foreground bg-muted rounded-md text-center', tv ? 'text-2xl' : 'text-lg')}
        >
          Login timed out. Please try again.
        </div>
        <div className="flex gap-4">
          <Button
            onClick={handleRetry}
            className={cn(actionClass, 'bg-[#E5A00D] hover:bg-[#CC8F0C] text-black')}
          >
            Try Again
          </Button>
          <Button
            onClick={handleCancel}
            variant="outline"
            className={actionClass}
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    )
  }

  const qrCode = authUrl ? (
    <div className={cn('bg-white', tv ? 'p-6 rounded-2xl' : 'p-4 rounded-lg')}>
      <QRCodeSVG
        value={authUrl}
        size={QR_SIZE[variant]}
        level="M"
        includeMargin={false}
        aria-label="Scan this QR code with your phone to log in"
      />
    </div>
  ) : (
    <div
      className={cn(
        'bg-muted animate-pulse flex items-center justify-center',
        tv ? 'size-[448px] rounded-2xl text-2xl' : 'w-[312px] h-[312px] rounded-lg'
      )}
    >
      <span className="text-muted-foreground">Loading...</span>
    </div>
  )

  const waiting = (
    <div className={cn('flex items-center gap-2 text-muted-foreground', tv && 'gap-3 text-2xl')}>
      <div className={cn('bg-[#E5A00D] rounded-full animate-pulse', tv ? 'size-3' : 'w-2 h-2')} />
      <span>Waiting for login... ({formatTime(timeRemaining)})</span>
    </div>
  )

  // Loading/Polling state, TV: steps and the code on the left, the QR on the right
  if (tv) {
    return (
      <div data-variant="tv" className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-16">
        <div className="space-y-8">
          <h2 className={headingClass}>Sign in with Plex</h2>
          <ol className="space-y-4 text-3xl text-muted-foreground">
            {['Scan the code with your phone', 'Sign in with your Plex account', 'This TV joins the club'].map(
              (step, i) => (
                <li key={step}>
                  <span className="mr-4 font-display font-black tabular-nums text-primary">{i + 1}</span>
                  {step}
                </li>
              )
            )}
          </ol>

          {/* Manual code - short PIN for plex.tv/link */}
          {shortPin && (
            <div>
              <p className="text-2xl text-muted-foreground">
                Or go to <span className="font-mono text-foreground">plex.tv/link</span> and enter
              </p>
              <p className="text-6xl font-mono font-bold text-foreground mt-4 tracking-widest">
                {shortPin.code}
              </p>
            </div>
          )}

          {waiting}

          <Button onClick={handleCancel} variant="outline" className={actionClass}>
            {cancelLabel}
          </Button>
        </div>

        {qrCode}
      </div>
    )
  }

  // Loading/Polling state
  return (
    <div className="flex flex-col items-center space-y-6 p-6">
      <h2 className="text-2xl font-bold text-foreground">Sign in with Plex</h2>

      {/* QR Code */}
      {qrCode}

      {/* Instructions */}
      <p className="text-lg text-muted-foreground text-center">
        Scan with your phone to log in
      </p>

      {/* Manual code - short PIN for plex.tv/link */}
      {shortPin && (
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Or enter this code at{' '}
            <span className="font-mono text-foreground">plex.tv/link</span>
          </p>
          <p className="text-3xl font-mono font-bold text-foreground mt-2 tracking-widest">
            {shortPin.code}
          </p>
        </div>
      )}

      {/* Status */}
      {waiting}

      {/* Cancel button */}
      <Button
        onClick={handleCancel}
        variant="outline"
        className="h-12 text-xl px-8"
      >
        {cancelLabel}
      </Button>
    </div>
  )
}
