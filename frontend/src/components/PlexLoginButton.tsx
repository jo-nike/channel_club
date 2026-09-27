import { Button } from '@/components/ui/button'

interface PlexLoginButtonProps {
  onClick: () => void
  /** True while waiting for the user to finish in the Plex window. */
  isLoading: boolean
  /** Shown as a Cancel button while loading. */
  onCancel?: () => void
  /** Disables the button without the waiting state (e.g. another sign-in is running). */
  disabled?: boolean
}

export function PlexLoginButton({ onClick, isLoading, onCancel, disabled = false }: PlexLoginButtonProps) {
  return (
    <>
      <Button
        type="button"
        onClick={onClick}
        disabled={isLoading || disabled}
        className="h-14 text-2xl px-8 w-full bg-[#E5A00D] hover:bg-[#CC8F0C] text-black"
      >
        {isLoading ? 'Waiting for Plex...' : 'Sign in with Plex'}
      </Button>
      {isLoading && onCancel && (
        <Button type="button" variant="ghost" onClick={onCancel} className="h-12 text-lg w-full">
          Cancel
        </Button>
      )}
    </>
  )
}
