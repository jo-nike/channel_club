import type { Ref } from 'react'
import { AccessSection } from '@/components/server-settings/sections/AccessSection'
import { errorTargetId } from '@/components/server-settings/sections/types'
import { PlexSignInPanel } from '../PlexSignInPanel'
import { ID_PREFIX, type SetupWizardApi } from '../useSetupWizard'
import { SettingsStep } from './SettingsStep'

/**
 * Step 4: who can join. An admin who signed up with a password and turns
 * Plex members on signs in to Plex here and picks the server; Continue
 * links it, then saves the step.
 */
export function AccessStep({ wizard, headingRef }: { wizard: SetupWizardApi; headingRef: Ref<HTMLHeadingElement> }) {
  const { state } = wizard
  return (
    <SettingsStep step="access" wizard={wizard} headingRef={headingRef}>
      {(settings) => (
        <AccessSection
          state={settings}
          errors={state.errors}
          onField={wizard.setField}
          idPrefix={ID_PREFIX}
          adminSignIn={state.admin?.signIn ?? 'password'}
          selfPlexId={state.admin?.plexId}
          // Loading from the moment a server is linked
          members={state.members ?? 'loading'}
          plexConnect={
            <PlexSignInPanel
              plex={state.plex}
              buttonId={errorTargetId(ID_PREFIX, 'plexLink')}
              error={state.errors.plex}
              disabled={state.busy !== null}
              onToken={wizard.plexSignIn}
              onSignOut={wizard.plexSignedOut}
              onPick={wizard.pickServer}
              onRefresh={wizard.refreshServers}
              onBeforeRedirect={wizard.stashForRedirect}
            />
          }
        />
      )}
    </SettingsStep>
  )
}
