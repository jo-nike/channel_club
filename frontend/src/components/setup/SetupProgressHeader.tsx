import { Wordmark } from '@/components/brand/Wordmark'
import { cn } from '@/lib/utils'
import { STEP_NAMES, STEPS, stepIndex } from './steps'
import type { WizardState } from './wizardReducer'

/** Where setup has got to, at the top of narrow windows in place of the rail. */
export function SetupProgressHeader({ state, className }: { state: WizardState; className?: string }) {
  const index = stepIndex(state.step)

  return (
    <header
      className={cn(
        'sticky top-0 z-[6] flex flex-col gap-2.5 border-b bg-background/90 px-[18px] pt-[calc(14px+env(safe-area-inset-top,0px))] pb-3 backdrop-blur-[10px]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <Wordmark size="sm" />
        <span className="text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums">
          {state.done ? 'Setup complete' : `Step ${index + 1} of ${STEPS.length}`}
        </span>
      </div>
      <span className="text-[14.5px] font-semibold">{STEP_NAMES[state.done ? 'done' : state.step]}</span>
      <div aria-hidden="true" className="grid grid-cols-6 gap-1">
        {STEPS.map((step, i) => (
          <span
            key={step}
            data-on={state.done || i <= index}
            className="h-1 rounded-[2px] bg-border transition-colors duration-250 data-[on=true]:bg-primary"
          />
        ))}
      </div>
    </header>
  )
}
