import { useState } from 'react'
import { flushSync } from 'react-dom'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MemberAvatar } from '@/components/MemberAvatar'
import { PlexLoginButton } from '@/components/PlexLoginButton'
import { QRPlexLogin } from '@/components/QRPlexLogin'
import { Callout } from '@/components/server-settings/fields/Callout'
import { FieldMessage } from '@/components/server-settings/fields/Field'
import { PlexServerPicker } from '@/components/server-settings/fields/PlexServerPicker'
import { SMALL_BUTTON } from '@/components/server-settings/fields/styles'
import { PLEX_ERROR_COPY, usePlexSignIn } from '@/hooks/usePlexSignIn'
import { useTVMode } from '@/hooks/useTVMode'
import { cn } from '@/lib/utils'
import { PlexAuthError } from '@/services/plexAuth'
import type { PlexSignIn } from './wizardReducer'

const HELP = 'text-[13px] leading-[1.45] text-pretty text-muted-foreground'

function ownedServers(count: number): string {
  if (count === 0) return 'Owns no Plex servers'
  return `Owner of ${count} ${count === 1 ? 'server' : 'servers'}`
}

interface PlexSignInPanelProps {
  plex: PlexSignIn
  /** The Sign in with Plex button's; "Use another account" is `${buttonId}-switch` */
  buttonId: string
  /** A problem the form found with the Plex sign-in */
  error?: string
  /** While the step saves */
  disabled?: boolean
  /** Take the token Plex gave. Throws an Error worded for the form. */
  onToken: (token: string, signal?: AbortSignal) => Promise<void>
  onSignOut: () => void
  onPick: (machineId: string) => void
  onRefresh: () => Promise<void>
  /** The page is about to leave for Plex's redirect sign-in */
  onBeforeRedirect: () => void
}

/**
 * Sign in with Plex, then pick one of the servers the account owns. On a TV
 * the button shows a code to sign in with on a phone; elsewhere a Plex
 * window opens, or on iPhones, iPads and installed apps the page goes to
 * Plex and comes back to /setup.
 */
export function PlexSignInPanel({
  plex,
  buttonId,
  error,
  disabled = false,
  onToken,
  onSignOut,
  onPick,
  onRefresh,
  onBeforeRedirect,
}: PlexSignInPanelProps) {
  const isTVMode = useTVMode()
  // A sign-in that didn't finish: a PlexAuthError offers Try again and a code
  const [failure, setFailure] = useState<PlexAuthError | string | null>(null)
  const [codeView, setCodeView] = useState(false)
  // A code sign-in's token is having its servers listed
  const [codeFinishing, setCodeFinishing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const signIn = usePlexSignIn({
    returnPath: '/setup',
    onBeforeRedirect,
    onStart: () => setFailure(null),
    onToken,
    onError: (err) => setFailure(err),
  })

  const showCode = () => {
    setFailure(null)
    setCodeView(true)
  }

  const start = () => {
    // A TV signs in with a code on a phone, as the sign-in page does
    if (isTVMode) showCode()
    else void signIn.start()
  }

  const finishCode = async (token: string) => {
    setCodeView(false)
    setCodeFinishing(true)
    try {
      await onToken(token)
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Couldn't finish Plex sign-in. Try again.")
    } finally {
      setCodeFinishing(false)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  // The sign-in button replaces this one, so focus goes there
  const switchAccount = () => {
    flushSync(onSignOut)
    document.getElementById(buttonId)?.focus()
  }

  const errorMessage = error && (
    <div role="alert" className="w-full">
      <FieldMessage tone="error">{error}</FieldMessage>
    </div>
  )

  if (plex.account) {
    const labelId = `${buttonId}-servers-label`
    return (
      <>
        <div className="flex w-full items-center gap-3 rounded-xl border border-success/30 bg-success/10 px-3.5 py-3">
          <MemberAvatar username={plex.account.username} decorative className="size-8 text-[13px]" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold [overflow-wrap:anywhere]">Signed in to Plex as {plex.account.username}</p>
            <p className={HELP}>{ownedServers(plex.servers.length)}</p>
          </div>
          <Button
            id={`${buttonId}-switch`}
            type="button"
            variant="ghost"
            className={SMALL_BUTTON}
            disabled={disabled || refreshing}
            onClick={switchAccount}
          >
            Use another account
          </Button>
        </div>

        <div className="flex w-full flex-col gap-[7px]">
          <div className="flex min-h-[34px] items-center justify-between gap-3">
            <span id={labelId} className="text-sm font-semibold">
              Your Plex server
            </span>
            <Button type="button" variant="ghost" className={SMALL_BUTTON} disabled={disabled || refreshing} onClick={() => void refresh()}>
              <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
              Refresh
            </Button>
          </div>
          {plex.servers.length > 0 ? (
            <PlexServerPicker servers={plex.servers} value={plex.machineId} onChange={onPick} name={`${buttonId}-server`} labelledBy={labelId} />
          ) : (
            <Callout tone="info">
              <p>This Plex account doesn't own a server. Sign in with the account that owns yours.</p>
            </Callout>
          )}
          <p className={HELP}>Only servers you own are listed. People you share the chosen server with can join the club.</p>
        </div>
        {errorMessage}
      </>
    )
  }

  if (codeView) {
    return (
      <div className="w-full">
        <QRPlexLogin
          onSuccess={(token) => void finishCode(token)}
          onCancel={() => setCodeView(false)}
          onError={(err) => setFailure(err.message)}
          onCodeRequested={() => setFailure(null)}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex w-full max-w-[360px] flex-col gap-2">
        <PlexLoginButton
          id={buttonId}
          onClick={start}
          onCancel={signIn.cancel}
          isLoading={signIn.waiting || codeFinishing}
          disabled={disabled}
        />
      </div>
      {!isTVMode && (
        <Button type="button" variant="ghost" className={SMALL_BUTTON} onClick={showCode} disabled={disabled || signIn.waiting}>
          Sign in with a code
        </Button>
      )}
      <p className={HELP}>Plex opens to sign you in. Channel Club never sees your Plex password.</p>
      {failure && (
        <Callout tone="danger" role="alert" className="w-full">
          <p>{typeof failure === 'string' ? failure : PLEX_ERROR_COPY[failure.code]}</p>
          {failure instanceof PlexAuthError && (
            <div className="flex flex-wrap gap-2">
              {/* Not the amber default: the Plex button stays the one amber action */}
              <Button type="button" variant="secondary" className={SMALL_BUTTON} onClick={start}>
                Try again
              </Button>
              <Button type="button" variant="outline" className={SMALL_BUTTON} onClick={showCode}>
                Sign in with a code
              </Button>
            </div>
          )}
        </Callout>
      )}
      {errorMessage}
    </>
  )
}
