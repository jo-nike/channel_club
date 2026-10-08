import type { ReactNode, Ref } from 'react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/server-settings/fields/Callout'
import { SMALL_BUTTON } from '@/components/server-settings/fields/styles'
import type { SettingsState } from '@/components/server-settings/model/configDraft'
import { FormErrorCallout } from '../FormErrorCallout'
import { StepHeader } from '../StepHeader'
import type { SetupWizardApi } from '../useSetupWizard'

interface SettingsStepProps {
  step: 'sources' | 'access' | 'extras' | 'review'
  wizard: SetupWizardApi
  headingRef: Ref<HTMLHeadingElement>
  /** The step's settings, once the server's have loaded */
  children?: (settings: SettingsState) => ReactNode
}

/** A step that works on the server's settings: its head, then the settings, or why they haven't loaded. */
export function SettingsStep({ step, wizard, headingRef, children }: SettingsStepProps) {
  const { settings, formError } = wizard.state

  return (
    <>
      <StepHeader step={step} headingRef={headingRef} />
      <FormErrorCallout error={formError} />
      {settings ? (
        children?.(settings)
      ) : wizard.configError ? (
        <Callout tone="danger" role="alert">
          <p>{wizard.configError}</p>
          <div>
            <Button type="button" variant="outline" className={SMALL_BUTTON} onClick={wizard.retryConfig}>
              Try again
            </Button>
          </div>
        </Callout>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the server's settings…
        </p>
      )}
    </>
  )
}
