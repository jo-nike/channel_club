import { useEffect } from 'react'
import { ArrowLeft, ArrowRight, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { StepId } from './steps'
import type { Busy } from './wizardReducer'

const BUSY_LABEL: Partial<Record<NonNullable<Busy>, string>> = {
  claim: 'Creating your account…',
  save: 'Saving…',
  // Linking the Plex server picked is the first part of saving Who can join
  link: 'Saving…',
  complete: 'Opening…',
}

interface SetupActionBarProps {
  step: StepId
  busy: Busy
  onBack: () => void
}

/**
 * Back and Continue, stuck to the bottom of the window. Continue submits the
 * wizard's form. While the step saves it says what it's doing, and it stays
 * focusable (aria-disabled, not disabled) so focus isn't lost if saving fails.
 */
export function SetupActionBar({ step, busy, onBack }: SetupActionBarProps) {
  const label = step === 'welcome' ? 'Start setup' : step === 'review' ? 'Open Channel Club' : 'Continue'
  const busyLabel = busy ? BUSY_LABEL[busy] : undefined

  // Keeps a control that takes focus clear of the bar (index.css)
  useEffect(() => {
    document.documentElement.classList.add('setup-action-bar')
    return () => document.documentElement.classList.remove('setup-action-bar')
  }, [])

  return (
    <div className="sticky bottom-0 z-[5] border-t bg-background/85 px-[18px] pt-3.5 pb-[calc(14px+env(safe-area-inset-bottom,0px))] backdrop-blur-md min-[760px]:px-[clamp(24px,6cqi,72px)]">
      <div className="flex max-w-[680px] items-center gap-3">
        {step !== 'welcome' && (
          <Button type="button" variant="outline" onClick={onBack} disabled={busy !== null} className="h-11 px-4 text-[15px]">
            <ArrowLeft aria-hidden="true" />
            Back
          </Button>
        )}
        {step === 'welcome' && (
          <p className="flex-1 text-[13px] text-muted-foreground max-[760px]:hidden">Takes about five minutes</p>
        )}
        <Button type="submit" aria-disabled={busy !== null || undefined} className="ml-auto h-11 px-5 text-[15px] max-[760px]:flex-1">
          {busyLabel ?? label}
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        </Button>
      </div>
    </div>
  )
}
