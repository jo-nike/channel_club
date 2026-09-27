import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { useTheme } from '@/hooks/useTheme'
import { useAuthStore } from '@/stores/authStore'
import { logger } from '@/lib/logger'
import { Button } from '@/components/ui/button'

/**
 * Short, user-safe description of a route error. Only the message is shown,
 * never the stack, so file names and internals stay out of the UI.
 */
function describeError(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}`.trim()
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown error'
}

/**
 * Root error element: replaces React Router's default error page (which
 * prints the raw stack trace) with a themed screen offering Reload and
 * Sign out.
 */
export function AppErrorScreen() {
  const error = useRouteError()

  // App may never have mounted (it can be the component that threw), so
  // apply the stored theme here as well.
  useTheme()

  useEffect(() => {
    logger.error('App', 'Unhandled route error', error)
  }, [error])

  const handleSignOut = () => {
    useAuthStore.getState().logout()
    window.location.assign('/')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <img src="/favicon.svg" alt="" className="h-14 w-14" />
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground">
        Channel Club hit an error. Reloading usually fixes it.
      </p>
      <div className="flex gap-3">
        <Button autoFocus onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button variant="outline" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
      <details className="max-w-md text-sm text-muted-foreground">
        <summary className="cursor-pointer">Details</summary>
        <p className="mt-2 break-words">{describeError(error)}</p>
      </details>
    </div>
  )
}
