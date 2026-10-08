import type { Ref } from 'react'
import { SourcesSection } from '@/components/server-settings/sections/SourcesSection'
import { ID_PREFIX, type SetupWizardApi } from '../useSetupWizard'
import { SettingsStep } from './SettingsStep'

/** Step 3: where the channels come from. Continue checks and saves them. */
export function SourcesStep({ wizard, headingRef }: { wizard: SetupWizardApi; headingRef: Ref<HTMLHeadingElement> }) {
  const { state } = wizard
  return (
    <SettingsStep step="sources" wizard={wizard} headingRef={headingRef}>
      {(settings) => (
        <SourcesSection
          state={settings}
          errors={state.errors}
          onField={wizard.setField}
          onSource={wizard.setSource}
          idPrefix={ID_PREFIX}
          tests={state.tests}
          onTest={wizard.runTest}
        />
      )}
    </SettingsStep>
  )
}
