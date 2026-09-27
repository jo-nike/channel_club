import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PlexLoginButtonProps {
  onClick: () => void
  /** True while waiting for the user to finish in the Plex window. */
  isLoading: boolean
  /** Shown as a Cancel button while loading. */
  onCancel?: () => void
  /** Disables the button without the waiting state (e.g. another sign-in is running). */
  disabled?: boolean
  /** Room-sized for a TV; otherwise desktop-sized. */
  tv?: boolean
}

export function PlexLoginButton({ onClick, isLoading, onCancel, disabled = false, tv = false }: PlexLoginButtonProps) {
  return (
    <>
      <Button
        type="button"
        onClick={onClick}
        disabled={isLoading || disabled}
        className={cn(
          'w-full bg-[#E5A00D] hover:bg-[#CC8F0C] text-black',
          tv ? 'h-14 text-2xl px-8' : 'h-12 text-base px-6'
        )}
      >
        {isLoading ? 'Waiting for Plex...' : 'Sign in with Plex'}
      </Button>
      {isLoading && onCancel && (
        <Button type="button" variant="ghost" onClick={onCancel} className="h-12 text-base w-full">
          Cancel
        </Button>
      )}
    </>
  )
}
