import { useEffect, useRef, type Ref } from 'react'
import { scrollBehavior } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { SetupActionBar } from './SetupActionBar'
import { SetupProgressHeader } from './SetupProgressHeader'
import { SetupRail } from './SetupRail'
import { HEADING_ID } from './StepHeader'
import { AccessStep } from './steps/AccessStep'
import { AccountStep } from './steps/AccountStep'
import { ExtrasStep } from './steps/ExtrasStep'
import { OnAirStep } from './steps/OnAirStep'
import { ReviewStep } from './steps/ReviewStep'
import { SourcesStep } from './steps/SourcesStep'
import { WelcomeStep } from './steps/WelcomeStep'
import { useSetupWizard, type SetupWizardApi, type WizardProps } from './useSetupWizard'

function StepContent({ wizard, headingRef }: { wizard: SetupWizardApi; headingRef: Ref<HTMLHeadingElement> }) {
  const { state } = wizard
  if (state.done) return <OnAirStep facts={state.facts} headingRef={headingRef} />
  switch (state.step) {
    case 'welcome':
      return <WelcomeStep envLocked={state.envLocked} headingRef={headingRef} />
    case 'account':
      return <AccountStep wizard={wizard} headingRef={headingRef} />
    case 'sources':
      return <SourcesStep wizard={wizard} headingRef={headingRef} />
    case 'access':
      return <AccessStep wizard={wizard} headingRef={headingRef} />
    case 'extras':
      return <ExtrasStep wizard={wizard} headingRef={headingRef} />
    case 'review':
      return <ReviewStep wizard={wizard} headingRef={headingRef} />
  }
}

/**
 * First-run setup: the steps down the side (a progress header in narrow
 * windows), one step at a time in a form, and Back and Continue at the bottom.
 */
export function SetupWizard(props: WizardProps) {
  const wizard = useSetupWizard(props)
  const { state } = wizard
  const headingRef = useRef<HTMLHeadingElement>(null)

  // A step opened: back to the top, and its heading takes focus so screen
  // readers announce it. Not on the first one shown, which the page opened on.
  const shown = `${state.step}:${state.done}`
  const lastShownRef = useRef(shown)
  useEffect(() => {
    if (lastShownRef.current === shown) return
    lastShownRef.current = shown
    window.scrollTo({ top: 0, behavior: scrollBehavior() })
    headingRef.current?.focus({ preventScroll: true })
  }, [shown])

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground min-[760px]:grid min-[760px]:grid-cols-[272px_minmax(0,1fr)]">
      <div className="hidden border-r bg-muted/30 min-[760px]:block">
        <SetupRail state={state} onGoTo={wizard.goTo} />
      </div>
      <SetupProgressHeader state={state} className="min-[760px]:hidden" />

      <main className="@container flex min-w-0 flex-1 flex-col">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void wizard.submit()
          }}
          className="flex flex-1 flex-col"
        >
          <div className="flex-1 px-[18px] pt-[26px] pb-[30px] min-[760px]:px-[clamp(24px,6cqi,72px)] min-[760px]:pt-12 min-[760px]:pb-10">
            {/* Keyed on the step, so each one plays the entrance */}
            <section
              key={shown}
              aria-labelledby={HEADING_ID}
              className={cn(
                'flex max-w-[680px] animate-in flex-col gap-6 duration-300 fill-mode-both fade-in slide-in-from-bottom-2',
                // On air centres itself in the whole column
                state.done && 'max-w-none'
              )}
            >
              <StepContent wizard={wizard} headingRef={headingRef} />
            </section>
          </div>
          {!state.done && <SetupActionBar step={state.step} busy={state.busy} onBack={wizard.back} />}
        </form>
      </main>
    </div>
  )
}
