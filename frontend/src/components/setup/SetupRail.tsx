import { Check } from 'lucide-react'
import { Wordmark } from '@/components/brand/Wordmark'
import { APP_NAME, APP_VERSION } from '@/lib/appInfo'
import { cn } from '@/lib/utils'
import { STEP_NAMES, STEPS, stepIndex, type StepId } from './steps'
import { stepSummary } from './summaries'
import type { WizardState } from './wizardReducer'

interface SetupRailProps {
  state: WizardState
  onGoTo: (step: StepId) => void
}

/**
 * The steps down the side in wide windows. A step reached can be opened
 * again; a done step shows a check and what was chosen there. Once setup
 * is finished every step is done and none opens.
 */
export function SetupRail({ state, onGoTo }: SetupRailProps) {
  const currentIndex = stepIndex(state.step)

  return (
    <nav
      aria-label="Setup steps"
      className="sticky top-0 flex h-dvh flex-col gap-[30px] overflow-y-auto px-4 pt-[calc(26px+env(safe-area-inset-top,0px))] pb-[22px]"
    >
      <div className="flex flex-col gap-[7px] px-2.5">
        <Wordmark size="md" />
        <span className="text-xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">Setup</span>
      </div>

      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {STEPS.map((step, i) => {
          const current = !state.done && i === currentIndex
          const done = !current && (state.done || i < state.reached)
          const summary = done ? stepSummary(state, step) : ''
          const summaryId = `setup-rail-${step}-summary`
          return (
            <li
              key={step}
              className={cn(
                // The line down to the next step's mark
                'relative not-last:before:absolute not-last:before:top-[39px] not-last:before:-bottom-[9px] not-last:before:left-[22px] not-last:before:w-0.5 not-last:before:rounded-[1px] not-last:before:bg-border',
                done && 'not-last:before:bg-primary/55'
              )}
            >
              <button
                type="button"
                onClick={() => onGoTo(step)}
                disabled={state.done || i > state.reached}
                aria-current={current ? 'step' : undefined}
                aria-describedby={summary ? summaryId : undefined}
                className={cn(
                  'flex min-h-11 w-full items-start gap-3 rounded-[10px] px-2.5 py-[9px] text-left text-muted-foreground enabled:hover:bg-accent/70 enabled:hover:text-foreground',
                  current && 'bg-accent text-foreground enabled:hover:bg-accent'
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-[26px] shrink-0 place-items-center rounded-full border-[1.5px] text-[12.5px] font-bold tabular-nums',
                    current ? 'border-primary bg-primary text-primary-foreground' : done ? 'border-primary text-primary' : 'border-border'
                  )}
                >
                  {done ? <Check className="size-[15px]" strokeWidth={2.6} /> : i + 1}
                </span>
                <span className="flex min-w-0 flex-col pt-0.5">
                  <span className="text-[14.5px] leading-[1.35] font-semibold">
                    {STEP_NAMES[step]}
                    {done && <span className="sr-only">, done</span>}
                  </span>
                  {summary && (
                    // Read as the button's description, not as part of its name
                    <span id={summaryId} aria-hidden="true" className="text-[12.5px] leading-[1.35] [overflow-wrap:anywhere] text-muted-foreground">
                      {summary}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      <div className="mt-auto flex flex-col gap-1 px-2.5 text-[12.5px] text-muted-foreground">
        <p>
          {APP_NAME} {APP_VERSION}
        </p>
      </div>
    </nav>
  )
}
