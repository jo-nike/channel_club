import type { Ref } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { MemberAvatar } from '@/components/MemberAvatar'
import { ChoiceCard } from '@/components/server-settings/fields/ChoiceCard'
import { Chip } from '@/components/server-settings/fields/Chip'
import { Field } from '@/components/server-settings/fields/Field'
import { PasswordRules } from '@/components/server-settings/fields/PasswordRules'
import { INPUT, SCROLL_MARGIN } from '@/components/server-settings/fields/styles'
import { cn } from '@/lib/utils'
import { FormErrorCallout } from '../FormErrorCallout'
import { PlexSignInPanel } from '@/components/server-settings/PlexSignInPanel'
import { StepHeader } from '../StepHeader'
import { pickedServerName } from '../summaries'
import { ACCOUNT_CONTROL, type SetupWizardApi } from '../useSetupWizard'
import type { WizardAdmin } from '../wizardReducer'

const CARD_BODY = 'flex flex-col items-start gap-3 px-5 pt-[18px] pb-5 max-[760px]:px-4'

interface AccountStepProps {
  wizard: SetupWizardApi
  headingRef: Ref<HTMLHeadingElement>
}

/** Once claimed, the account can't change here: the step shows who is signed in. */
function SignedInCard({ admin, serverName }: { admin: WizardAdmin; serverName: string | null }) {
  return (
    <Card className="flex-row items-center gap-3 px-5 py-[18px] max-[760px]:px-4">
      <MemberAvatar username={admin.username} decorative className="size-8 text-[13px]" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold [overflow-wrap:anywhere]">Signed in as {admin.username}</p>
        <p className="text-sm text-muted-foreground">
          {admin.signIn === 'password' ? 'Username and password' : serverName ? `Plex · ${serverName}` : 'Plex'}
        </p>
      </div>
    </Card>
  )
}

/** Step 2: how the first admin signs in. Continue claims the club with it. */
export function AccountStep({ wizard, headingRef }: AccountStepProps) {
  const { state } = wizard
  const { account, errors } = state
  const claiming = state.busy === 'claim'

  if (state.admin) {
    return (
      <>
        <StepHeader step="account" headingRef={headingRef} />
        <SignedInCard admin={state.admin} serverName={state.settings?.view.plexServerName ?? pickedServerName(state)} />
      </>
    )
  }

  return (
    <>
      <StepHeader step="account" headingRef={headingRef} />
      <FormErrorCallout error={state.formError} />

      <fieldset className="m-0 grid min-w-0 grid-cols-2 gap-3 border-0 p-0 max-[760px]:grid-cols-1">
        <legend className="sr-only">Your sign-in</legend>
        <ChoiceCard
          name="setup-signin"
          value="plex"
          checked={account.method === 'plex'}
          onChange={() => wizard.setMethod('plex')}
          disabled={claiming}
          title={
            <>
              Plex account <Chip tone="primary">For Plex groups</Chip>
            </>
          }
          description="Sign in with Plex and pick your server. Everyone you share it with can join, and you're their admin."
        />
        <ChoiceCard
          name="setup-signin"
          value="password"
          checked={account.method === 'password'}
          onChange={() => wizard.setMethod('password')}
          disabled={claiming}
          title="Username and password"
          description="Make an admin account on this server. Works without Plex."
        />
      </fieldset>

      {account.method === 'plex' ? (
        <Card className="gap-0 py-0">
          <div className={CARD_BODY}>
            <PlexSignInPanel
              plex={state.plex}
              buttonId={ACCOUNT_CONTROL.plexSignIn}
              error={errors.plex}
              disabled={claiming}
              onToken={wizard.plexSignIn}
              onSignOut={wizard.plexSignedOut}
              onPick={wizard.pickServer}
              onRefresh={wizard.refreshServers}
              returnPath="/setup"
              onBeforeRedirect={wizard.stashForRedirect}
            />
          </div>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <div className={cn(CARD_BODY, 'items-stretch gap-[18px]')}>
            <Field id={ACCOUNT_CONTROL.username} label="Username" error={errors.username}>
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={account.username}
                  onChange={(event) => wizard.setAccount('username', event.target.value)}
                  className={cn(INPUT, SCROLL_MARGIN)}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
              <Field id={ACCOUNT_CONTROL.password} label="Password" error={errors.password}>
                {(control) => (
                  <PasswordInput
                    {...control}
                    autoComplete="new-password"
                    value={account.password}
                    onChange={(event) => wizard.setAccount('password', event.target.value)}
                    className={cn(INPUT, SCROLL_MARGIN)}
                  />
                )}
              </Field>
              <Field id={ACCOUNT_CONTROL.confirm} label="Confirm password" error={errors.confirm}>
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    autoComplete="new-password"
                    value={account.confirm}
                    onChange={(event) => wizard.setAccount('confirm', event.target.value)}
                    className={cn(INPUT, SCROLL_MARGIN)}
                  />
                )}
              </Field>
            </div>
            <PasswordRules password={account.password} confirm={account.confirm} />
          </div>
        </Card>
      )}
    </>
  )
}
