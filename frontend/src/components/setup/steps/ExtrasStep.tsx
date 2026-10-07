import type { Ref } from 'react'
import { ExtrasSection } from '@/components/server-settings/sections/ExtrasSection'
import { ID_PREFIX, type SetupWizardApi } from '../useSetupWizard'
import { SettingsStep } from './SettingsStep'

/** Step 5: chat, clips and feedback. Continue checks and saves them. */
export function ExtrasStep({ wizard, headingRef }: { wizard: SetupWizardApi; headingRef: Ref<HTMLHeadingElement> }) {
  const { state } = wizard
  return (
    <SettingsStep step="extras" wizard={wizard} headingRef={headingRef}>
      {(settings) => (
        <ExtrasSection
          state={settings}
          errors={state.errors}
          onField={wizard.setField}
          idPrefix={ID_PREFIX}
          tests={state.tests}
          onTest={wizard.runTest}
        />
      )}
    </SettingsStep>
  )
}
