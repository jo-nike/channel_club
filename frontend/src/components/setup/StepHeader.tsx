import type { ReactNode, Ref } from 'react'
import { cn } from '@/lib/utils'
import { STEP_HEADS, STEPS, stepIndex, type StepId } from './steps'

/** The id every step's h1 has: the step's section is named by it. */
export const HEADING_ID = 'setup-heading'

interface StepHeadingProps {
  headingRef: Ref<HTMLHeadingElement>
  className?: string
  children: ReactNode
}

/**
 * A step's h1. It takes focus when the step opens, so screen readers announce
 * the new step; it is a heading, not a control, so it draws no focus ring.
 */
export function StepHeading({ headingRef, className, children }: StepHeadingProps) {
  return (
    <h1 id={HEADING_ID} tabIndex={-1} ref={headingRef} className={cn('outline-none', className)}>
      {children}
    </h1>
  )
}

/** A step's eyebrow ("Step 3 of 6"), its h1 and its lead. */
export function StepHeader({ step, headingRef }: { step: Exclude<StepId, 'welcome'>; headingRef: Ref<HTMLHeadingElement> }) {
  const { title, lead } = STEP_HEADS[step]
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">
        Step {stepIndex(step) + 1} of {STEPS.length}
      </p>
      <StepHeading headingRef={headingRef} className="text-[38px] leading-none tracking-[0.004em] text-balance min-[760px]:text-[46px]">
        {title}
      </StepHeading>
      <p className="max-w-[58ch] text-base leading-[1.55] text-pretty text-muted-foreground">{lead}</p>
    </div>
  )
}
