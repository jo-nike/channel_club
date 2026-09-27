import { Button } from '@/components/ui/button'

interface PlexLoginButtonProps {
  onClick: () => void
  isLoading: boolean
}

export function PlexLoginButton({ onClick, isLoading }: PlexLoginButtonProps) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      className="h-14 text-2xl px-8 w-full bg-[#E5A00D] hover:bg-[#CC8F0C] text-black"
    >
      {isLoading ? 'Signing in...' : 'Sign in with Plex'}
    </Button>
  )
}
