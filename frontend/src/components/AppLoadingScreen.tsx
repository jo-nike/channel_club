import { APP_TAGLINE } from '@/lib/appInfo'
import { Wordmark } from '@/components/brand/Wordmark'

/**
 * The branded loading screen: wordmark, tagline and a spinner. The app shows
 * it while checking auth, and the sign-in form while its config loads, so the
 * two waits look like one.
 */
export function AppLoadingScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background pt-safe pb-safe">
      <h1 className="mb-4 text-foreground">
        <Wordmark size="lg" />
      </h1>
      <p className="mb-6 text-muted-foreground">{APP_TAGLINE}</p>
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      {/* Reduce Motion freezes the ring, so the text says it is still loading */}
      <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
    </div>
  )
}
